import type { DB, Payment } from '@farmgo/db';
import { Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { audit } from './audit.js';

/**
 * What the buyer has paid on an order: successful collections, minus refunds that have not
 * failed (pending refunds count, so the same money is never refunded twice).
 */
export async function orderBalance(db: DB, orderId: string) {
  const rows = await db.payment.findMany({
    where: { orderId },
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

/** Orders on which the buyer owes nothing: the produce never reached them. */
export const NOTHING_OWED_STATUSES = ['CANCELLED', 'QA_REJECTED'] as const;

/**
 * Refund a buyer. Creates a pending OUT payment (sent by B2C to the number that paid, by the
 * payments worker) and updates the order's payment status. `adminId` is null for automatic
 * refunds (cancellation, QA rejection, QA partial acceptance).
 */
export async function refundOrder(
  tx: DB,
  a: { orderId: string; amount: number; adminId?: string | null; reason: string },
): Promise<Payment> {
  const order = await tx.order.findUnique({ where: { id: a.orderId }, include: { payments: true } });
  if (!order) throw Errors.notFound('Order');
  const { paidIn, refunded, net } = await orderBalance(tx, order.id);
  if (a.amount <= 0 || a.amount > net) {
    throw Errors.badRequest('REFUND_TOO_LARGE', `You can refund at most ${net / 100} KES on this order`);
  }
  const source = order.payments.find((p) => p.direction === 'IN' && p.status === 'SUCCESS');
  const refund = await tx.payment.create({
    data: {
      orderId: order.id,
      method: source?.method ?? 'BANK_TRANSFER',
      direction: 'OUT',
      amount: a.amount,
      phoneNumber: source?.phoneNumber,
      status: 'PENDING',
      resultDesc: a.reason,
      idempotencyKey: `refund:${order.id}:${refunded + a.amount}`,
      initiatedById: a.adminId ?? null,
    },
  });
  await tx.order.update({
    where: { id: order.id },
    data: { paymentStatus: refunded + a.amount >= paidIn ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
  await audit(tx, {
    actorId: a.adminId ?? null,
    action: 'payment.refund',
    entity: 'Order',
    entityId: order.id,
    after: { amount: a.amount, reason: a.reason, automatic: !a.adminId },
  });
  await emit(tx, 'refund.requested', { paymentId: refund.id, orderId: order.id }, order.id);
  return refund;
}

/**
 * Bring what the buyer has paid back in line with what they owe: nothing for a cancelled or
 * QA-rejected order, otherwise the order total (accepted produce + delivery). Refunds the
 * difference if they paid more. Idempotent. Returns the refund, if one was needed.
 */
export async function refundExcess(tx: DB, orderId: string, reason: string): Promise<Payment | null> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const owed = (NOTHING_OWED_STATUSES as readonly string[]).includes(order.status) ? 0 : order.total;
  const { net } = await orderBalance(tx, orderId);
  const excess = net - owed;
  if (excess <= 0) return null;
  return refundOrder(tx, { orderId, amount: excess, adminId: null, reason });
}
