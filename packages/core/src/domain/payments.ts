import { env } from '@farmgo/config';
import { type DB, num, type Payment, type Payout, type PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { logger } from '../logger.js';
import { emit } from '../outbox.js';
import { getCard } from '../providers/card.js';
import { getMpesa } from '../providers/mpesa.js';
import { enqueue } from '../queues.js';
import { audit } from './audit.js';
import { nextInvoiceNumber } from './codes.js';
import { applyInputOrderPayment, inputOrderBalance } from './input-orders.js';
import { lineTotal, payoutFor } from './money.js';
import { disputeWindowClosed, settleOrderIfComplete } from './order-machine.js';
import { NOTHING_OWED_STATUSES, orderBalance, refundExcess } from './refunds.js';
import { getSetting } from './settings.js';

const PAYABLE_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED'];

// ─── Buyer collection (STK push) ──────────────────────────────

interface StkTarget {
  orderId?: string;
  invoiceId?: string;
  /** A cart checkout: one STK push for all its orders. */
  checkoutId?: string;
  /** A green-input order. */
  inputOrderId?: string;
  buyerOrgId: string;
  amount: number;
  reference: string;
}

async function startStk(
  prisma: PrismaClient,
  target: StkTarget,
  phoneNumber: string,
  userId: string,
): Promise<Payment> {
  const scope = target.orderId
    ? { orderId: target.orderId }
    : target.inputOrderId
      ? { inputOrderId: target.inputOrderId }
      : target.checkoutId
        ? { checkoutId: target.checkoutId, allocatedFromId: null }
        : { invoiceId: target.invoiceId };
  // Reuse a recent pending request instead of spamming the buyer's phone.
  const recent = await prisma.payment.findFirst({
    where: {
      ...scope,
      status: 'PENDING',
      method: 'MPESA_STK',
      createdAt: { gt: new Date(Date.now() - 2 * 60_000) },
    },
  });
  if (recent) return recent;

  const attempt = await prisma.payment.count({ where: scope });
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        orderId: target.orderId,
        invoiceId: target.invoiceId,
        checkoutId: target.checkoutId,
        inputOrderId: target.inputOrderId,
        method: 'MPESA_STK',
        amount: target.amount,
        phoneNumber,
        idempotencyKey: `stk:${target.orderId ?? target.checkoutId ?? target.inputOrderId ?? target.invoiceId}:${attempt + 1}`,
        initiatedById: userId,
      },
    });
    await markOrdersPending(tx, target);
    return p;
  });

  try {
    const res = await getMpesa().stkPush({
      phoneNumber,
      amountCents: target.amount,
      accountReference: target.reference,
      description: 'FarmGo order',
    });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutRequestId: res.checkoutRequestId, merchantRequestId: res.merchantRequestId },
    });
    const delay = (await getSetting(prisma, 'stkCheckDelaySeconds')) * 1000;
    const isMock = getMpesa().name === 'mock';
    await enqueue(
      'payments',
      'stk-timeout-check',
      { paymentId: payment.id },
      {
        delay: isMock ? 2_000 : delay,
        jobId: `stk-check-${payment.id}`,
      },
    );
    await emit(prisma, 'payment.updated', {
      paymentId: payment.id,
      orderId: target.orderId ?? null,
      checkoutId: target.checkoutId ?? null,
      buyerOrgId: target.buyerOrgId,
      status: 'PENDING',
    });
    return updated;
  } catch (err) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', resultDesc: err instanceof Error ? err.message : 'STK push failed' },
      });
      await releasePendingOrders(tx, target);
    });
    throw err instanceof AppError
      ? err
      : Errors.upstream('MPESA_UNAVAILABLE', 'M-Pesa is not responding. Try again shortly.');
  }
}

/** Orders a collection is for: one order, or every order of a checkout. */
function ordersOf(target: { orderId?: string | null; checkoutId?: string | null }) {
  if (target.orderId) return { id: target.orderId };
  if (target.checkoutId) return { checkoutId: target.checkoutId };
  return null;
}

type Collected = { orderId?: string | null; checkoutId?: string | null; inputOrderId?: string | null };

async function markOrdersPending(tx: DB, target: Collected) {
  if (target.inputOrderId) {
    await tx.inputOrder.updateMany({
      where: { id: target.inputOrderId, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PENDING' },
    });
  }
  const where = ordersOf(target);
  if (where)
    await tx.order.updateMany({
      where: { ...where, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PENDING' },
    });
}

async function releasePendingOrders(tx: DB, target: Collected) {
  if (target.inputOrderId) {
    await tx.inputOrder.updateMany({
      where: { id: target.inputOrderId, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'UNPAID' },
    });
  }
  const where = ordersOf(target);
  if (where)
    await tx.order.updateMany({
      where: { ...where, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'UNPAID' },
    });
}

/** What is still owed across a checkout's orders (cancelled and rejected orders owe nothing). */
export async function checkoutBalanceDue(db: DB, checkoutId: string): Promise<number> {
  const orders = await db.order.findMany({ where: { checkoutId } });
  let due = 0;
  for (const o of orders) {
    if ((NOTHING_OWED_STATUSES as readonly string[]).includes(o.status) || o.paymentTerms !== 'PREPAID')
      continue;
    due += Math.max(0, o.total - (await orderBalance(db, o.id)).net);
  }
  return due;
}

/** M-Pesa STK push for a green-input order (what is still due on it). */
export async function payInputOrderWithMpesa(
  prisma: PrismaClient,
  a: { inputOrderId: string; userId: string; phoneNumber?: string | null },
): Promise<Payment> {
  const o = await prisma.inputOrder.findUnique({ where: { id: a.inputOrderId } });
  if (!o || o.buyerId !== a.userId) throw Errors.notFound('Input order');
  if (['REJECTED', 'CANCELLED'].includes(o.status)) {
    throw Errors.conflict('ORDER_NOT_PAYABLE', `This order is ${o.status.toLowerCase()}`);
  }
  const due = o.total - (await inputOrderBalance(prisma, o.id)).net;
  if (due <= 0) throw Errors.conflict('ALREADY_PAID', 'This order is already paid');
  return startStk(
    prisma,
    { inputOrderId: o.id, buyerOrgId: '', amount: due, reference: `INP-${o.id.slice(-6).toUpperCase()}` },
    requirePhone(a.phoneNumber),
    a.userId,
  );
}

/** One M-Pesa STK push for everything still owed on a cart checkout. */
export async function payCheckoutWithMpesa(
  prisma: PrismaClient,
  a: {
    checkoutId: string;
    buyerOrgId: string;
    userId: string;
    phoneNumber?: string | null;
    card?: CardPayer;
  },
): Promise<StartedPayment> {
  const checkout = await prisma.checkout.findUnique({
    where: { id: a.checkoutId },
    include: { orders: { orderBy: { createdAt: 'asc' }, select: { code: true } } },
  });
  if (!checkout || checkout.buyerOrgId !== a.buyerOrgId) throw Errors.notFound('Checkout');
  const due = await checkoutBalanceDue(prisma, checkout.id);
  if (due <= 0) throw Errors.conflict('ALREADY_PAID', 'Nothing is due on this checkout');
  return startCollection(
    prisma,
    {
      checkoutId: checkout.id,
      buyerOrgId: checkout.buyerOrgId,
      amount: due,
      reference: checkout.orders[0]?.code ?? 'FarmGo',
    },
    a,
  );
}

// ─── Card collection (hosted checkout) ────────────────────────

/** Who is paying by card: the provider pre-fills the hosted page with it. */
export interface CardPayer {
  userId: string;
  email?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
}

export type StartedPayment = Payment & { redirectUrl?: string };

const CARD_REUSE_MS = 20 * 60_000;
const CARD_TIMEOUT_MS = 60 * 60_000;

/**
 * Start a card payment: create the Payment, ask the provider for a hosted checkout and return
 * where to send the buyer. A recent unpaid attempt is reused rather than opening a new one.
 */
async function startCard(prisma: PrismaClient, target: StkTarget, payer: CardPayer): Promise<StartedPayment> {
  const scope = target.orderId
    ? { orderId: target.orderId }
    : target.inputOrderId
      ? { inputOrderId: target.inputOrderId }
      : target.checkoutId
        ? { checkoutId: target.checkoutId, allocatedFromId: null }
        : { invoiceId: target.invoiceId };
  const recent = await prisma.payment.findFirst({
    where: {
      ...scope,
      status: 'PENDING',
      method: 'CARD',
      amount: target.amount,
      createdAt: { gt: new Date(Date.now() - CARD_REUSE_MS) },
    },
  });
  const recentUrl = (recent?.raw as { redirectUrl?: string } | null)?.redirectUrl;
  if (recent && recentUrl) return { ...recent, redirectUrl: recentUrl };

  const attempt = await prisma.payment.count({ where: scope });
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        orderId: target.orderId,
        invoiceId: target.invoiceId,
        checkoutId: target.checkoutId,
        inputOrderId: target.inputOrderId,
        method: 'CARD',
        amount: target.amount,
        phoneNumber: payer.phoneNumber ?? null,
        idempotencyKey: `card:${target.orderId ?? target.checkoutId ?? target.inputOrderId ?? target.invoiceId}:${attempt + 1}`,
        initiatedById: payer.userId,
      },
    });
    await markOrdersPending(tx, target);
    return p;
  });
  try {
    const res = await getCard().createCheckout({
      reference: payment.id,
      amountCents: target.amount,
      description: `FarmGo ${target.reference}`,
      callbackUrl: `${env.API_URL.replace(/\/$/, '')}/v1/payments/card-return?paymentId=${payment.id}`,
      email: payer.email,
      phoneNumber: payer.phoneNumber,
      name: payer.name,
    });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutRequestId: res.trackingId, raw: { redirectUrl: res.redirectUrl } },
    });
    await emit(prisma, 'payment.updated', {
      paymentId: payment.id,
      orderId: target.orderId ?? null,
      checkoutId: target.checkoutId ?? null,
      buyerOrgId: target.buyerOrgId,
      status: 'PENDING',
    });
    return { ...updated, redirectUrl: res.redirectUrl };
  } catch (err) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', resultDesc: err instanceof Error ? err.message : 'Card checkout failed' },
      });
      await releasePendingOrders(tx, target);
    });
    throw err instanceof AppError
      ? err
      : Errors.upstream('CARD_UNAVAILABLE', 'Card payments are not available right now. Try M-Pesa.');
  }
}

/**
 * Confirm a card payment with the provider's status API and apply it (used by the IPN, the
 * return page and the reconcile cron). Never trusts a notification alone.
 */
export async function checkCardStatus(
  prisma: PrismaClient,
  paymentId: string,
): Promise<'settled' | 'pending'> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (payment?.status !== 'PENDING' || payment.method !== 'CARD' || !payment.checkoutRequestId)
    return 'settled';
  const res = await getCard().getStatus(payment.checkoutRequestId);
  if (res.status === 'PENDING') {
    if (Date.now() - payment.createdAt.getTime() < CARD_TIMEOUT_MS) return 'pending';
    await applyStkOutcome(prisma, {
      checkoutRequestId: payment.checkoutRequestId,
      resultCode: '1037',
      resultDesc: 'The card payment was not completed in time',
    });
    return 'settled';
  }
  await applyStkOutcome(prisma, {
    checkoutRequestId: payment.checkoutRequestId,
    resultCode: res.status === 'COMPLETED' ? '0' : '1',
    resultDesc: res.description,
    receipt: res.status === 'COMPLETED' ? res.confirmationCode : undefined,
    amountCents: res.amountCents,
  });
  return 'settled';
}

/** Start a collection by M-Pesa (STK push) or card (hosted checkout). */
async function startCollection(
  prisma: PrismaClient,
  target: StkTarget,
  a: { userId: string; phoneNumber?: string | null; card?: CardPayer },
): Promise<StartedPayment> {
  if (a.card) return startCard(prisma, target, a.card);
  return startStk(prisma, target, requirePhone(a.phoneNumber), a.userId);
}

const requirePhone = (phone: string | null | undefined): string => {
  if (!phone) throw Errors.badRequest('PHONE_REQUIRED', 'Enter the M-Pesa number to charge');
  return phone;
};

export async function payOrderWithMpesa(
  prisma: PrismaClient,
  a: { orderId: string; buyerOrgId: string; userId: string; phoneNumber?: string | null; card?: CardPayer },
): Promise<StartedPayment> {
  const order = await prisma.order.findUnique({ where: { id: a.orderId } });
  if (!order || order.buyerOrgId !== a.buyerOrgId) throw Errors.notFound('Order');
  if (order.paymentTerms !== 'PREPAID') {
    throw Errors.badRequest(
      'ORDER_ON_INVOICE',
      'This order is billed on your invoice. Pay the invoice instead.',
    );
  }
  if (!PAYABLE_STATUSES.includes(order.status)) {
    throw Errors.conflict(
      'ORDER_NOT_PAYABLE',
      `Orders that are ${order.status.toLowerCase()} cannot be paid`,
    );
  }
  // Only what is still due (an earlier underpayment counts towards it).
  const due = order.total - (await orderBalance(prisma, order.id)).net;
  if (order.paymentStatus === 'PAID' || due <= 0)
    throw Errors.conflict('ALREADY_PAID', 'This order is already paid');
  return startCollection(
    prisma,
    { orderId: order.id, buyerOrgId: order.buyerOrgId, amount: due, reference: order.code },
    a,
  );
}

export async function payInvoiceWithMpesa(
  prisma: PrismaClient,
  a: { invoiceId: string; buyerOrgId: string; userId: string; phoneNumber?: string | null; card?: CardPayer },
): Promise<StartedPayment> {
  const invoice = await prisma.invoice.findUnique({ where: { id: a.invoiceId } });
  if (!invoice || invoice.buyerOrgId !== a.buyerOrgId) throw Errors.notFound('Invoice');
  if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
    throw Errors.conflict('INVOICE_NOT_PAYABLE', `This invoice is ${invoice.status.toLowerCase()}`);
  }
  const due = invoice.total - invoice.amountPaid;
  return startCollection(
    prisma,
    { invoiceId: invoice.id, buyerOrgId: invoice.buyerOrgId, amount: due, reference: invoice.number },
    a,
  );
}

/** Update one order after money was recorded against it: paid, part-paid, or refund what is not owed. */
async function applyOrderPayment(tx: DB, orderId: string) {
  {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const { net } = await orderBalance(tx, order.id);
    if ((NOTHING_OWED_STATUSES as readonly string[]).includes(order.status)) {
      // Money arrived after the order was cancelled or rejected: send it straight back.
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
      await refundExcess(tx, order.id, `Payment received after the order was ${order.status.toLowerCase()}`);
    } else if (net >= order.total) {
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
      if (net > order.total) await refundExcess(tx, order.id, 'Paid more than the order total');
      await settleOrderIfComplete(tx, order.id);
    } else {
      // Part-paid: the order stays unpaid and the next payment asks only for the balance.
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'UNPAID' } });
    }
  }
}

/**
 * Share a checkout payment across its orders, oldest first, as per-order ledger entries
 * (`allocatedFromId`), so each order is paid, refunded and settled on its own. Anything left
 * over (e.g. an order was cancelled meanwhile) goes to the first order and is refunded there.
 */
async function allocateCheckoutPayment(tx: DB, payment: Payment, amount: number) {
  const orders = await tx.order.findMany({
    where: { checkoutId: payment.checkoutId! },
    orderBy: { createdAt: 'asc' },
  });
  let remaining = amount;
  const shares = new Map<string, number>();
  for (const o of orders) {
    if ((NOTHING_OWED_STATUSES as readonly string[]).includes(o.status)) continue;
    const owed = Math.max(0, o.total - (await orderBalance(tx, o.id)).net);
    const share = Math.min(owed, remaining);
    if (share > 0) shares.set(o.id, share);
    remaining -= share;
  }
  if (remaining > 0 && orders[0]) shares.set(orders[0].id, (shares.get(orders[0].id) ?? 0) + remaining);
  for (const [orderId, share] of shares) {
    await tx.payment.create({
      data: {
        orderId,
        checkoutId: payment.checkoutId,
        allocatedFromId: payment.id,
        method: payment.method,
        direction: 'IN',
        amount: share,
        phoneNumber: payment.phoneNumber,
        status: 'SUCCESS',
        resultDesc: `Share of checkout payment ${payment.mpesaReceipt ?? payment.id}`,
        idempotencyKey: `alloc:${payment.id}:${orderId}`,
        initiatedById: payment.initiatedById,
      },
    });
  }
  for (const o of orders) await applyOrderPayment(tx, o.id);
}

/** Apply a confirmed payment amount to its order, checkout or invoice. */
async function applySuccess(tx: DB, payment: Payment, amount: number) {
  if (payment.orderId) await applyOrderPayment(tx, payment.orderId);
  if (payment.checkoutId && !payment.orderId) await allocateCheckoutPayment(tx, payment, amount);
  if (payment.inputOrderId) await applyInputOrderPayment(tx, payment.inputOrderId);
  if (payment.invoiceId) {
    const inv = await tx.invoice.update({
      where: { id: payment.invoiceId },
      data: { amountPaid: { increment: amount } },
    });
    const fullyPaid = inv.amountPaid >= inv.total;
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID' },
    });
    if (fullyPaid) {
      const orders = await tx.order.findMany({ where: { invoiceId: inv.id } });
      for (const o of orders) {
        await tx.order.update({ where: { id: o.id }, data: { paymentStatus: 'PAID' } });
        await settleOrderIfComplete(tx, o.id);
      }
    }
  }
}

export interface StkOutcome {
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  receipt?: string;
  amountShillings?: number;
  /** Exact amount received in cents (card payments); takes precedence over amountShillings. */
  amountCents?: number;
  raw?: unknown;
}

/**
 * Apply an STK result (from the Daraja callback or a status query). Idempotent: results for
 * payments that are no longer pending are ignored.
 */
export async function applyStkOutcome(prisma: PrismaClient, o: StkOutcome): Promise<Payment | null> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { checkoutRequestId: o.checkoutRequestId },
      include: { order: true, invoice: true, checkout: true },
    });
    if (!payment) {
      logger.warn({ checkoutRequestId: o.checkoutRequestId }, 'STK result for unknown payment');
      return null;
    }
    if (payment.status !== 'PENDING') return payment;

    const success = o.resultCode === '0';
    const status = success
      ? 'SUCCESS'
      : o.resultCode === '1032'
        ? 'CANCELLED'
        : o.resultCode === '1037'
          ? 'TIMEOUT'
          : 'FAILED';
    // Guard against callbacks reporting less than we asked for: record only what arrived, so an
    // underpaid order is not released as paid. Collections are rounded up to whole shillings.
    const underpaid =
      success &&
      (o.amountCents !== undefined
        ? o.amountCents < payment.amount
        : o.amountShillings !== undefined && o.amountShillings < Math.ceil(payment.amount / 100));
    const received = !underpaid ? payment.amount : (o.amountCents ?? o.amountShillings! * 100);
    if (underpaid) {
      logger.error(
        { paymentId: payment.id, received, expected: payment.amount },
        'STK amount lower than requested',
      );
    }
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        ...(underpaid
          ? {
              amount: received,
              resultDesc: `${o.resultDesc} (underpaid: received ${received / 100} of ${payment.amount / 100} KES)`,
            }
          : {}),
        status,
        resultCode: o.resultCode,
        ...(underpaid ? {} : { resultDesc: o.resultDesc }),
        mpesaReceipt: o.receipt,
        raw: o.raw === undefined ? undefined : (o.raw as object),
      },
    });
    if (success) {
      await applySuccess(tx, updated, received);
    } else {
      await releasePendingOrders(tx, payment);
    }
    await audit(tx, {
      action: `payment.${status.toLowerCase()}`,
      entity: 'Payment',
      entityId: payment.id,
      after: { receipt: o.receipt, resultCode: o.resultCode },
    });
    await emit(
      tx,
      'payment.updated',
      {
        paymentId: payment.id,
        orderId: payment.orderId,
        checkoutId: payment.checkoutId,
        buyerOrgId:
          payment.order?.buyerOrgId ?? payment.checkout?.buyerOrgId ?? payment.invoice?.buyerOrgId ?? '',
        status,
      },
      payment.id,
    );
    return updated;
  });
}

/** Query Daraja for a payment still pending (used by the delayed check and the reconcile cron). */
export async function checkStkStatus(
  prisma: PrismaClient,
  paymentId: string,
): Promise<'settled' | 'pending'> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (payment?.status !== 'PENDING' || !payment.checkoutRequestId) return 'settled';
  const res = await getMpesa().stkQuery(payment.checkoutRequestId);
  if (res.resultCode === null) {
    const ageMin = (Date.now() - payment.createdAt.getTime()) / 60_000;
    if (ageMin > 10) {
      await applyStkOutcome(prisma, {
        checkoutRequestId: payment.checkoutRequestId,
        resultCode: '1037',
        resultDesc: 'Timed out waiting for the customer',
      });
      return 'settled';
    }
    return 'pending';
  }
  await applyStkOutcome(prisma, {
    checkoutRequestId: payment.checkoutRequestId,
    resultCode: res.resultCode,
    resultDesc: res.resultDesc,
  });
  return 'settled';
}

/** Cron: check every STK payment stuck in PENDING for more than 2 minutes. */
export async function reconcilePayments(prisma: PrismaClient): Promise<number> {
  const stuck = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      method: { in: ['MPESA_STK', 'CARD'] },
      checkoutRequestId: { not: null },
      createdAt: { lt: new Date(Date.now() - 2 * 60_000) },
    },
    select: { id: true, method: true },
    take: 200,
  });
  for (const p of stuck) {
    try {
      if (p.method === 'CARD') await checkCardStatus(prisma, p.id);
      else await checkStkStatus(prisma, p.id);
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, 'reconcile: status check failed');
    }
  }
  return stuck.length;
}

/** Admin records an offline payment (bank transfer or cash). */
export async function recordManualPayment(
  prisma: PrismaClient,
  a: {
    orderId?: string;
    invoiceId?: string;
    amount: number;
    method: 'BANK_TRANSFER' | 'CASH';
    reference: string;
    adminId: string;
  },
): Promise<Payment> {
  return prisma.$transaction(async (tx) => {
    let due: number;
    // Admins may type the order code (FG-26-001000) or invoice number (INV-26-00012) instead of the id.
    let orderId: string | undefined;
    let invoiceId: string | undefined;
    if (a.orderId) {
      const ref = a.orderId.trim();
      const order = await tx.order.findFirst({ where: { OR: [{ id: ref }, { code: ref.toUpperCase() }] } });
      if (!order) throw Errors.notFound('Order');
      orderId = order.id;
      if (!PAYABLE_STATUSES.includes(order.status) && order.status !== 'PAID') {
        throw Errors.conflict(
          'ORDER_NOT_PAYABLE',
          `Orders that are ${order.status.toLowerCase()} cannot be paid`,
        );
      }
      due = order.total - (await orderBalance(tx, order.id)).net;
    } else {
      const ref = (a.invoiceId ?? '').trim();
      const inv = await tx.invoice.findFirst({ where: { OR: [{ id: ref }, { number: ref.toUpperCase() }] } });
      if (!inv) throw Errors.notFound('Invoice');
      invoiceId = inv.id;
      if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)) {
        throw Errors.conflict('INVOICE_NOT_PAYABLE', `This invoice is ${inv.status.toLowerCase()}`);
      }
      due = inv.total - inv.amountPaid;
    }
    if (due <= 0) throw Errors.conflict('ALREADY_PAID', 'Nothing is due on this');
    if (a.amount > due) {
      throw Errors.badRequest('AMOUNT_EXCEEDS_DUE', `Only ${due / 100} KES is due`, { dueCents: due });
    }
    const p = await tx.payment.create({
      data: {
        orderId,
        invoiceId,
        method: a.method,
        amount: a.amount,
        status: 'SUCCESS',
        resultDesc: a.reference,
        idempotencyKey: `manual:${a.method}:${a.reference}`,
        initiatedById: a.adminId,
      },
    });
    await applySuccess(tx, p, a.amount);
    await audit(tx, {
      actorId: a.adminId,
      action: 'payment.manual',
      entity: 'Payment',
      entityId: p.id,
      after: { ...a, orderId, invoiceId },
    });
    return p;
  });
}

/**
 * Hourly: settle delivered orders whose dispute window has closed, and request payouts for
 * pre-financed invoice orders. Returns how many orders were settled.
 */
export async function settleDeliveredOrders(prisma: PrismaClient): Promise<number> {
  const hours = await getSetting(prisma, 'disputeWindowHours');
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const due = await prisma.order.findMany({
    where: {
      status: 'DELIVERED',
      OR: [{ deliveredAt: { lte: cutoff } }, { receiptConfirmedAt: { not: null } }],
    },
    select: { id: true, paymentTerms: true },
    take: 500,
  });
  let settled = 0;
  for (const o of due) {
    const done = await prisma.$transaction((tx) => settleOrderIfComplete(tx, o.id));
    if (done) settled++;
    else if (o.paymentTerms !== 'PREPAID') await emit(prisma, 'payout.requested', { orderId: o.id }, o.id);
  }
  return settled;
}

/** Buyer confirms the delivery was fine: closes the dispute window and settles if paid. */
export async function confirmReceipt(tx: DB, orderId: string, userId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw Errors.notFound('Order');
  if (order.status !== 'DELIVERED')
    throw Errors.conflict('ORDER_NOT_DELIVERED', 'Only delivered orders can be confirmed');
  if (!order.receiptConfirmedAt) {
    await tx.order.update({ where: { id: orderId }, data: { receiptConfirmedAt: new Date() } });
    await audit(tx, { actorId: userId, action: 'order.confirm_receipt', entity: 'Order', entityId: orderId });
  }
  if (!(await settleOrderIfComplete(tx, orderId, userId)) && order.paymentTerms !== 'PREPAID') {
    await emit(tx, 'payout.requested', { orderId }, orderId);
  }
}

// ─── Farmer payouts (B2C) ─────────────────────────────────────

/** Produce value the buyer accepted after QA: accepted quantity × price per item. */
export async function acceptedSubtotal(db: DB, orderId: string): Promise<number> {
  const items = await db.orderItem.findMany({ where: { orderId }, include: { inspection: true } });
  return items.reduce((sum, i) => {
    const qty = i.inspection ? num(i.inspection.acceptedQty) : num(i.quantity);
    return sum + lineTotal(qty, i.pricePerUnit);
  }, 0);
}

/**
 * Create the farmer's payout once the order is eligible: it is PAID (buyer paid and the
 * dispute window closed), or it is an invoice order past its dispute window and the platform
 * pre-finances invoices. Disputed orders are held. Idempotent (one payout per order).
 */
export async function requestPayout(prisma: PrismaClient, orderId: string): Promise<Payout | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      payout: true,
      disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
      farmer: { include: { farmerProfile: true } },
    },
  });
  if (!order || order.payout) return order?.payout ?? null;
  if (order.disputes.length > 0) return null;
  const settled = order.status === 'PAID';
  const prefinanced =
    order.status === 'DELIVERED' &&
    order.paymentTerms !== 'PREPAID' &&
    (await getSetting(prisma, 'prefinanceInvoiceOrders')) &&
    (await disputeWindowClosed(prisma, order));
  if (!settled && !prefinanced) return null;

  const phone = order.farmer.farmerProfile?.mpesaNumber ?? order.farmer.phoneNumber;
  if (!phone) {
    logger.error({ orderId }, 'payout: farmer has no M-Pesa number');
    return null;
  }
  // Dispute refunds (made by an admin) come off the farmer's payout. Automatic refunds for rejected
  // quantity or overpayment do not: the accepted subtotal already excludes that produce.
  const refunds = await prisma.payment.aggregate({
    where: {
      orderId,
      direction: 'OUT',
      status: { in: ['SUCCESS', 'PENDING'] },
      initiatedById: { not: null },
    },
    _sum: { amount: true },
  });
  const gross = Math.max(
    0,
    (order.acceptedSubtotal ?? (await acceptedSubtotal(prisma, orderId))) - (refunds._sum.amount ?? 0),
  );
  const commissionBps = await getSetting(prisma, 'commissionBps');
  const p = payoutFor(gross, commissionBps);

  const payout = await prisma.payout.upsert({
    where: { orderId },
    create: {
      orderId,
      farmerId: order.farmerId,
      phoneNumber: phone,
      grossAmount: p.gross,
      commission: p.commission,
      amount: p.net,
      idempotencyKey: `payout:${orderId}`,
    },
    update: {},
  });
  await enqueue('payments', 'b2c-payout', { orderId }, { jobId: `payout-${orderId}` });
  return payout;
}

/** Short reference for a payout: the order code, or the green-input order reference. */
export const payoutReference = (p: { order?: { code: string } | null; inputOrderId?: string | null }) =>
  p.order?.code ?? (p.inputOrderId ? `INP-${p.inputOrderId.slice(-6).toUpperCase()}` : 'FarmGo');

/** Send the B2C transfer for a produce order's pending payout. */
export async function executePayout(prisma: PrismaClient, orderId: string): Promise<Payout | null> {
  const payout = await prisma.payout.findUnique({ where: { orderId }, include: { order: true } });
  return sendPayout(prisma, payout);
}

/** Send the B2C transfer for a green-input supplier payout. */
export async function executeInputPayout(prisma: PrismaClient, inputOrderId: string): Promise<Payout | null> {
  const payout = await prisma.payout.findUnique({ where: { inputOrderId }, include: { order: true } });
  return sendPayout(prisma, payout);
}

async function sendPayout(
  prisma: PrismaClient,
  payout: (Payout & { order: { code: string } | null }) | null,
): Promise<Payout | null> {
  if (payout?.status !== 'PENDING' || payout.conversationId) return payout;
  if (payout.amount <= 0) {
    return applyPayoutOutcome(prisma, { payoutId: payout.id, resultCode: '0', resultDesc: 'Nothing to pay' });
  }
  const res = await getMpesa().b2c({
    phoneNumber: payout.phoneNumber,
    amountCents: payout.amount,
    remarks: `FarmGo payout ${payoutReference(payout)}`,
    occasion: payoutReference(payout),
  });
  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      conversationId: res.conversationId,
      originatorConversationId: res.originatorConversationId,
      attempts: { increment: 1 },
    },
  });
  if (res.immediateResult) {
    return applyPayoutOutcome(prisma, { payoutId: payout.id, ...res.immediateResult });
  }
  return prisma.payout.findUnique({ where: { id: payout.id } });
}

export async function applyPayoutOutcome(
  prisma: PrismaClient,
  o: {
    payoutId?: string;
    conversationId?: string;
    resultCode: string;
    resultDesc: string;
    receipt?: string;
    raw?: unknown;
  },
): Promise<Payout | null> {
  return prisma.$transaction(async (tx) => {
    const payout = o.payoutId
      ? await tx.payout.findUnique({ where: { id: o.payoutId } })
      : await tx.payout.findUnique({ where: { conversationId: o.conversationId } });
    if (!payout) {
      logger.warn({ conversationId: o.conversationId }, 'B2C result for unknown payout');
      return null;
    }
    if (payout.status !== 'PENDING') return payout;
    const status = o.resultCode === '0' ? 'SUCCESS' : 'FAILED';
    const updated = await tx.payout.update({
      where: { id: payout.id },
      data: {
        status,
        resultCode: o.resultCode,
        resultDesc: o.resultDesc,
        mpesaReceipt: o.receipt,
        raw: o.raw === undefined ? undefined : (o.raw as object),
      },
    });
    await audit(tx, {
      action: `payout.${status.toLowerCase()}`,
      entity: 'Payout',
      entityId: payout.id,
      after: o,
    });
    await emit(
      tx,
      'payout.updated',
      {
        payoutId: payout.id,
        orderId: payout.orderId,
        inputOrderId: payout.inputOrderId,
        farmerId: payout.farmerId,
        status,
        amount: payout.amount,
      },
      payout.id,
    );
    return updated;
  });
}

/** Admin retries a failed payout (e.g. after the farmer fixes their M-Pesa number). */
export async function retryPayout(
  prisma: PrismaClient,
  orderId: string,
  adminId: string,
): Promise<Payout | null> {
  const payout = await prisma.payout.findUnique({
    where: { orderId },
    include: { farmer: { include: { farmerProfile: true } } },
  });
  if (!payout) throw Errors.notFound('Payout');
  if (payout.status !== 'FAILED')
    throw Errors.conflict('PAYOUT_NOT_FAILED', 'Only failed payouts can be retried');
  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status: 'PENDING',
      conversationId: null,
      originatorConversationId: null,
      phoneNumber: payout.farmer.farmerProfile?.mpesaNumber ?? payout.phoneNumber,
    },
  });
  await audit(prisma, { actorId: adminId, action: 'payout.retry', entity: 'Payout', entityId: payout.id });
  await enqueue('payments', 'b2c-payout', { orderId }, { jobId: `payout-${orderId}-retry-${Date.now()}` });
  return prisma.payout.findUnique({ where: { id: payout.id } });
}

// ─── Refunds ──────────────────────────────────────────────────

/** Send pending M-Pesa refunds (B2C to the buyer's paying number). */
export async function executeRefund(prisma: PrismaClient, paymentId: string): Promise<void> {
  const refund = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (refund?.direction !== 'OUT' || refund.status !== 'PENDING') return;
  if (refund.method !== 'MPESA_STK' || !refund.phoneNumber) return; // offline refunds are settled manually
  const res = await getMpesa().b2c({
    phoneNumber: refund.phoneNumber,
    amountCents: refund.amount,
    remarks: `FarmGo refund ${refund.order?.code ?? ''}`,
  });
  const done = res.immediateResult;
  await prisma.payment.update({
    where: { id: refund.id },
    data: {
      merchantRequestId: res.conversationId,
      ...(done
        ? {
            status: done.resultCode === '0' ? 'SUCCESS' : 'FAILED',
            resultCode: done.resultCode,
            mpesaReceipt: done.receipt,
          }
        : {}),
    },
  });
}

// ─── Invoices (NET terms buyers) ──────────────────────────────

const TERM_DAYS = { PREPAID: 0, NET_7: 7, NET_14: 14, NET_30: 30 } as const;

/**
 * Weekly: bill each credit-terms buyer for delivered orders not yet invoiced.
 * Returns the number of invoices issued.
 */
export async function generateInvoices(prisma: PrismaClient, now = new Date()): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      invoiceId: null,
      paymentTerms: { not: 'PREPAID' },
      paymentStatus: 'UNPAID',
      status: { in: ['DELIVERED', 'PAID'] },
    },
  });
  const byOrg = new Map<string, typeof orders>();
  for (const o of orders) {
    if (!byOrg.has(o.buyerOrgId)) byOrg.set(o.buyerOrgId, []);
    byOrg.get(o.buyerOrgId)!.push(o);
  }
  let issued = 0;
  for (const [buyerOrgId, list] of byOrg) {
    await prisma.$transaction(async (tx) => {
      const terms = list[0]!.paymentTerms;
      const subtotal = list.reduce((s, o) => s + o.total, 0);
      const invoice = await tx.invoice.create({
        data: {
          number: await nextInvoiceNumber(tx),
          buyerOrgId,
          periodStart: new Date(Math.min(...list.map((o) => o.createdAt.getTime()))),
          periodEnd: now,
          subtotal,
          total: subtotal,
          status: 'ISSUED',
          issuedAt: now,
          dueAt: new Date(now.getTime() + TERM_DAYS[terms] * 86_400_000),
        },
      });
      await tx.order.updateMany({
        where: { id: { in: list.map((o) => o.id) } },
        data: { invoiceId: invoice.id },
      });
    });
    issued++;
  }
  return issued;
}

export async function markOverdueInvoices(prisma: PrismaClient, now = new Date()): Promise<number> {
  const res = await prisma.invoice.updateMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueAt: { lt: now } },
    data: { status: 'OVERDUE' },
  });
  return res.count;
}
