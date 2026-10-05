import type { DB, InputOrder, InputOrderStatus, Payment, Payout, PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { enqueue } from '../queues.js';
import { audit } from './audit.js';
import { payoutFor } from './money.js';
import { getSetting } from './settings.js';

/**
 * Green-input orders (QA-024) follow the produce escrow: the buyer pays by M-Pesa when ordering,
 * the money is held, a rejected or cancelled order is refunded, and the supplier is paid by B2C
 * (minus commission) when the buyer confirms delivery or the problem window after dispatch
 * closes. A reported problem holds the payout until an admin resolves it.
 */

/** Paid on an input order net of refunds that have not failed. */
export async function inputOrderBalance(db: DB, inputOrderId: string) {
  const rows = await db.payment.findMany({
    where: { inputOrderId },
    select: { direction: true, status: true, amount: true },
  });
  const paidIn = rows
    .filter((p) => p.direction === 'IN' && p.status === 'SUCCESS')
    .reduce((s, p) => s + p.amount, 0);
  const refunded = rows
    .filter((p) => p.direction === 'OUT' && p.status !== 'FAILED')
    .reduce((s, p) => s + p.amount, 0);
  return { paidIn, refunded, net: paidIn - refunded };
}

const OWES_NOTHING: readonly string[] = ['REJECTED', 'CANCELLED'];

/** Refund a green-input buyer (B2C to the number that paid, sent by the payments worker). */
export async function refundInputOrder(
  tx: DB,
  a: { inputOrderId: string; amount: number; adminId?: string | null; reason: string },
): Promise<Payment> {
  const { paidIn, refunded, net } = await inputOrderBalance(tx, a.inputOrderId);
  if (a.amount <= 0 || a.amount > net) {
    throw Errors.badRequest('REFUND_TOO_LARGE', `You can refund at most ${net / 100} KES on this order`);
  }
  const source = await tx.payment.findFirst({
    where: { inputOrderId: a.inputOrderId, direction: 'IN', status: 'SUCCESS' },
  });
  const refund = await tx.payment.create({
    data: {
      inputOrderId: a.inputOrderId,
      method: source?.method ?? 'BANK_TRANSFER',
      direction: 'OUT',
      amount: a.amount,
      phoneNumber: source?.phoneNumber,
      status: 'PENDING',
      resultDesc: a.reason,
      idempotencyKey: `refund:input:${a.inputOrderId}:${refunded + a.amount}`,
      initiatedById: a.adminId ?? null,
    },
  });
  await tx.inputOrder.update({
    where: { id: a.inputOrderId },
    data: { paymentStatus: refunded + a.amount >= paidIn ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
  await audit(tx, {
    actorId: a.adminId ?? null,
    action: 'payment.refund',
    entity: 'InputOrder',
    entityId: a.inputOrderId,
    after: { amount: a.amount, reason: a.reason, automatic: !a.adminId },
  });
  await emit(tx, 'refund.requested', { paymentId: refund.id, orderId: a.inputOrderId }, a.inputOrderId);
  return refund;
}

/** Refund whatever the buyer paid beyond what they owe (everything, if rejected or cancelled). */
export async function refundInputExcess(tx: DB, inputOrderId: string, reason: string) {
  const o = await tx.inputOrder.findUniqueOrThrow({ where: { id: inputOrderId } });
  const owed = OWES_NOTHING.includes(o.status) ? 0 : o.total;
  const { net } = await inputOrderBalance(tx, inputOrderId);
  if (net - owed <= 0) return null;
  return refundInputOrder(tx, { inputOrderId, amount: net - owed, adminId: null, reason });
}

/** After money is recorded on an input order: paid, part-paid, or refund what is not owed. */
export async function applyInputOrderPayment(tx: DB, inputOrderId: string) {
  const o = await tx.inputOrder.findUniqueOrThrow({ where: { id: inputOrderId } });
  const { net } = await inputOrderBalance(tx, inputOrderId);
  if (OWES_NOTHING.includes(o.status)) {
    await tx.inputOrder.update({ where: { id: o.id }, data: { paymentStatus: 'PAID' } });
    await refundInputExcess(tx, o.id, `Payment received after the order was ${o.status.toLowerCase()}`);
  } else if (net >= o.total) {
    await tx.inputOrder.update({ where: { id: o.id }, data: { paymentStatus: 'PAID' } });
    if (net > o.total) await refundInputExcess(tx, o.id, 'Paid more than the order total');
  } else {
    await tx.inputOrder.update({ where: { id: o.id }, data: { paymentStatus: 'UNPAID' } });
  }
}

/** Supplier-side and buyer-side moves. The buyer marking DELIVERED confirms receipt. */
const SUPPLIER_MOVES: Partial<Record<InputOrderStatus, InputOrderStatus[]>> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
};
const BUYER_MOVES: Partial<Record<InputOrderStatus, InputOrderStatus[]>> = {
  PENDING: ['CANCELLED'],
  DISPATCHED: ['DELIVERED'],
};

export async function transitionInputOrder(
  prisma: PrismaClient,
  a: { inputOrderId: string; userId: string; to: InputOrderStatus },
): Promise<InputOrder> {
  return prisma.$transaction(async (tx) => {
    const o = await tx.inputOrder.findUnique({ where: { id: a.inputOrderId }, include: { product: true } });
    if (!o) throw Errors.notFound('Input order');
    const isSupplier = !!(await tx.member.findFirst({
      where: { organizationId: o.product.supplierOrgId, userId: a.userId },
    }));
    const isBuyer = o.buyerId === a.userId;
    if (!isSupplier && !isBuyer) throw Errors.notFound('Input order');
    const allowed = [
      ...(isSupplier ? (SUPPLIER_MOVES[o.status] ?? []) : []),
      ...(isBuyer ? (BUYER_MOVES[o.status] ?? []) : []),
    ];
    if (!allowed.includes(a.to)) {
      throw new AppError('INPUT_ORDER_INVALID_TRANSITION', `Cannot move from ${o.status} to ${a.to}`, 409, {
        allowed,
      });
    }
    if (a.to === 'DISPATCHED' && o.paymentStatus !== 'PAID') {
      throw Errors.conflict('INPUT_ORDER_UNPAID', 'Wait for the buyer to pay before dispatching');
    }
    if (a.to === 'REJECTED' || a.to === 'CANCELLED') {
      await tx.inputProduct.update({
        where: { id: o.productId },
        data: { stock: { increment: o.quantity } },
      });
    }
    const now = new Date();
    const updated = await tx.inputOrder.update({
      where: { id: o.id },
      data: {
        status: a.to,
        ...(a.to === 'DISPATCHED' ? { dispatchedAt: now } : {}),
        ...(a.to === 'DELIVERED'
          ? { deliveredAt: now, ...(isBuyer ? { receiptConfirmedAt: now } : {}) }
          : {}),
      },
    });
    if (a.to === 'REJECTED' || a.to === 'CANCELLED') {
      await refundInputExcess(
        tx,
        o.id,
        a.to === 'REJECTED' ? 'Supplier declined the order' : 'Order cancelled',
      );
    }
    await emit(
      tx,
      'input_order.status_changed',
      { inputOrderId: o.id, supplierOrgId: o.product.supplierOrgId, buyerId: o.buyerId, to: a.to },
      o.id,
    );
    return updated;
  });
}

/** When the buyer can no longer report a problem: they confirmed receipt, or the window since dispatch passed. */
export async function inputWindowClosed(db: DB, o: InputOrder, now = new Date()) {
  if (o.receiptConfirmedAt) return true;
  if (!o.dispatchedAt) return false;
  const hours = await getSetting(db, 'disputeWindowHours');
  return now.getTime() - o.dispatchedAt.getTime() >= hours * 3600_000;
}

/** Buyer reports a problem with a dispatched or delivered input order; the payout is held. */
export async function raiseInputDispute(
  prisma: PrismaClient,
  a: { inputOrderId: string; userId: string; reason: string; description: string; photos: string[] },
) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.inputOrder.findUnique({ where: { id: a.inputOrderId }, include: { payout: true } });
    if (!o || o.buyerId !== a.userId) throw Errors.notFound('Input order');
    if (!['DISPATCHED', 'DELIVERED'].includes(o.status) || o.payout) {
      throw new AppError(
        'ORDER_NOT_DISPUTABLE',
        'You can report a problem once the order is dispatched',
        409,
      );
    }
    if (await inputWindowClosed(tx, o)) {
      throw new AppError('DISPUTE_WINDOW_CLOSED', 'The window to report a problem has closed', 409);
    }
    const open = await tx.dispute.findFirst({
      where: { inputOrderId: o.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    });
    if (open) throw Errors.conflict('DISPUTE_OPEN', 'A problem is already being reviewed for this order');
    return tx.dispute.create({
      data: {
        inputOrderId: o.id,
        raisedById: a.userId,
        reason: a.reason,
        description: a.description,
        photos: a.photos,
      },
    });
  });
}

/** The phone and user that receive a supplier's payouts: the org phone, else the owner's phone. */
async function supplierPayee(db: DB, supplierOrgId: string) {
  const [profile, owner] = await Promise.all([
    db.orgProfile.findUnique({ where: { organizationId: supplierOrgId } }),
    db.member.findFirst({
      where: { organizationId: supplierOrgId },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      include: { user: true },
    }),
  ]);
  return { userId: owner?.userId ?? null, phone: profile?.phone ?? owner?.user.phoneNumber ?? null };
}

/**
 * Create the supplier's payout once the order is complete: paid, dispatched or delivered, the
 * buyer's window closed, and no open problem report. Idempotent.
 */
export async function requestInputPayout(prisma: PrismaClient, inputOrderId: string): Promise<Payout | null> {
  const o = await prisma.inputOrder.findUnique({
    where: { id: inputOrderId },
    include: {
      payout: true,
      product: true,
      disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
    },
  });
  if (!o || o.payout) return o?.payout ?? null;
  if (o.disputes.length || !['DISPATCHED', 'DELIVERED'].includes(o.status)) return null;
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(o.paymentStatus)) return null;
  if (!(await inputWindowClosed(prisma, o))) return null;
  const payee = await supplierPayee(prisma, o.product.supplierOrgId);
  if (!payee.userId || !payee.phone) return null;
  const { net } = await inputOrderBalance(prisma, o.id);
  const p = payoutFor(Math.max(0, net), await getSetting(prisma, 'commissionBps'));
  const payout = await prisma.payout.upsert({
    where: { inputOrderId: o.id },
    create: {
      inputOrderId: o.id,
      farmerId: payee.userId,
      phoneNumber: payee.phone,
      grossAmount: p.gross,
      commission: p.commission,
      amount: p.net,
      idempotencyKey: `payout:input:${o.id}`,
    },
    update: {},
  });
  await enqueue('payments', 'b2c-input-payout', { inputOrderId: o.id }, { jobId: `payout-input-${o.id}` });
  return payout;
}

/**
 * Hourly: dispatched orders the buyer never confirmed become DELIVERED once the window closes,
 * and every complete order gets its supplier payout. Returns how many payouts were requested.
 */
export async function settleInputOrders(prisma: PrismaClient): Promise<number> {
  const hours = await getSetting(prisma, 'disputeWindowHours');
  const cutoff = new Date(Date.now() - hours * 3600_000);
  await prisma.inputOrder.updateMany({
    where: { status: 'DISPATCHED', dispatchedAt: { lte: cutoff } },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  });
  const due = await prisma.inputOrder.findMany({
    where: {
      payout: null,
      status: { in: ['DISPATCHED', 'DELIVERED'] },
      paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      OR: [{ receiptConfirmedAt: { not: null } }, { dispatchedAt: { lte: cutoff } }],
    },
    select: { id: true },
    take: 500,
  });
  let n = 0;
  for (const o of due) if (await requestInputPayout(prisma, o.id)) n++;
  return n;
}
