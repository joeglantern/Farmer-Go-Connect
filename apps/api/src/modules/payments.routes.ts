import {
  EarningsDto,
  EarningsQuery,
  IdParams,
  InvoiceDetailDto,
  InvoicePageDto,
  Pagination,
  PaymentDetailDto,
  PaymentPageDto,
  PaymentStartedDto,
  PayOrderInput,
  PayoutPageDto,
  PayoutQuery,
} from '@farmgo/contracts';
import {
  Errors,
  getSetting,
  nairobiDate,
  nairobiDayStart,
  payInvoiceWithMpesa,
  payoutFor,
} from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireOrg, requirePermission, requireRole, requireUser } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { accepted, ok, typed } from '../lib/route.js';

/**
 * Whose payouts a request covers: the farmer's own (default) or, with as=supplier, those of the
 * caller's green-input business. `held` is the expected net of paid orders not yet paid out
 * (buyer's window still open, or a problem under review).
 */
export async function payoutScope(
  req: FastifyRequest,
  as: 'farmer' | 'supplier' | undefined,
): Promise<{ where: Prisma.PayoutWhereInput; held: number }> {
  const prisma = req.server.prisma;
  const commissionBps = await getSetting(prisma, 'commissionBps');
  if (as === 'supplier') {
    requirePermission(req, { input: ['sell'] });
    const { orgId } = await requireOrg(req, 'INPUT_SUPPLIER');
    const waiting = await prisma.inputOrder.findMany({
      where: {
        product: { supplierOrgId: orgId },
        payout: null,
        paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
        status: { notIn: ['REJECTED', 'CANCELLED'] },
      },
      select: { total: true },
    });
    return {
      where: { inputOrder: { product: { supplierOrgId: orgId } } },
      held: waiting.reduce((s, o) => s + payoutFor(o.total, commissionBps).net, 0),
    };
  }
  const user = requireRole(req, 'farmer');
  const waiting = await prisma.order.findMany({
    where: {
      farmerId: user.id,
      payout: null,
      paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      status: { in: ['QA_PASSED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'PAID'] },
    },
    select: { subtotal: true, acceptedSubtotal: true, commission: true },
  });
  return {
    where: { farmerId: user.id, orderId: { not: null } },
    held: waiting.reduce((s, o) => s + Math.max(0, (o.acceptedSubtotal ?? o.subtotal) - o.commission), 0),
  };
}

export default async function paymentRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/earnings',
    {
      schema: {
        tags: ['payments'],
        summary:
          'Earnings per month (farmer, or as=supplier): gross, commission, net, orders, and what is settling',
        querystring: EarningsQuery,
        response: ok(EarningsDto),
      },
    },
    async (req) => {
      const { where, held } = await payoutScope(req, req.query.as);
      const monthKeys: string[] = [];
      const current = nairobiDate(new Date()).slice(0, 7);
      let [y, m] = current.split('-').map(Number) as [number, number];
      for (let i = 0; i < req.query.months; i++) {
        monthKeys.push(`${y}-${String(m).padStart(2, '0')}`);
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      const since = nairobiDayStart(`${monthKeys.at(-1)}-01`);
      const [paid, pending] = await Promise.all([
        app.prisma.payout.findMany({
          where: { ...where, status: 'SUCCESS', createdAt: { gte: since } },
          select: { grossAmount: true, commission: true, amount: true, createdAt: true },
        }),
        app.prisma.payout.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true } }),
      ]);
      const buckets = new Map(
        monthKeys.map((k) => [k, { month: k, grossCents: 0, commissionCents: 0, netCents: 0, orders: 0 }]),
      );
      for (const p of paid) {
        const b = buckets.get(nairobiDate(p.createdAt).slice(0, 7));
        if (!b) continue;
        b.grossCents += p.grossAmount;
        b.commissionCents += p.commission;
        b.netCents += p.amount;
        b.orders += 1;
      }
      const months = [...buckets.values()];
      const sum = (k: 'grossCents' | 'commissionCents' | 'netCents' | 'orders') =>
        months.reduce((s, x) => s + x[k], 0);
      return {
        months,
        totals: {
          grossCents: sum('grossCents'),
          commissionCents: sum('commissionCents'),
          netCents: sum('netCents'),
          orders: sum('orders'),
        },
        pendingCents: (pending._sum.amount ?? 0) + held,
      };
    },
  );

  r.get(
    '/v1/payments',
    {
      schema: {
        tags: ['payments'],
        summary: "My organization's payments",
        querystring: Pagination,
        response: ok(PaymentPageDto),
      },
    },
    async (req) => {
      requirePermission(req, { payment: ['read'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const rows = await app.prisma.payment.findMany({
        // A checkout payment is listed once; its per-order shares are ledger entries shown on each order.
        where: {
          allocatedFromId: null,
          OR: [
            { order: { buyerOrgId: orgId } },
            { invoice: { buyerOrgId: orgId } },
            { checkout: { buyerOrgId: orgId } },
          ],
        },
        include: {
          order: { select: { id: true, code: true } },
          invoice: { select: { id: true, number: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.get(
    '/v1/payments/:id',
    {
      schema: {
        tags: ['payments'],
        summary: 'Poll a payment (e.g. after an STK push)',
        params: IdParams,
        response: ok(PaymentDetailDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const p = await app.prisma.payment.findUnique({
        where: { id: req.params.id },
        include: { order: true, invoice: true, checkout: { select: { buyerOrgId: true } } },
      });
      if (!p) throw Errors.notFound('Payment');
      const orgId = p.order?.buyerOrgId ?? p.invoice?.buyerOrgId ?? p.checkout?.buyerOrgId;
      const member = orgId
        ? await app.prisma.member.findFirst({ where: { organizationId: orgId, userId: user.id } })
        : null;
      if (!member && user.role !== 'admin') throw Errors.notFound('Payment');
      const { checkout: _checkout, ...rest } = p;
      return rest;
    },
  );

  r.get(
    '/v1/invoices',
    {
      schema: {
        tags: ['payments'],
        summary: "My organization's invoices",
        querystring: Pagination,
        response: ok(InvoicePageDto),
      },
    },
    async (req) => {
      requirePermission(req, { payment: ['read'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const rows = await app.prisma.invoice.findMany({
        where: { buyerOrgId: orgId },
        include: { _count: { select: { orders: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.get(
    '/v1/invoices/:id',
    {
      schema: {
        tags: ['payments'],
        summary: 'An invoice with its orders and payments',
        params: IdParams,
        response: ok(InvoiceDetailDto),
      },
    },
    async (req) => {
      requirePermission(req, { payment: ['read'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const inv = await app.prisma.invoice.findUnique({
        where: { id: req.params.id },
        include: {
          orders: { select: { id: true, code: true, total: true, deliveryDate: true, status: true } },
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              method: true,
              mpesaReceipt: true,
              createdAt: true,
            },
          },
        },
      });
      if (!inv || inv.buyerOrgId !== orgId) throw Errors.notFound('Invoice');
      return inv;
    },
  );

  r.post(
    '/v1/invoices/:id/pay',
    {
      schema: {
        tags: ['payments'],
        summary: 'Pay an invoice by M-Pesa or card',
        params: IdParams,
        body: PayOrderInput,
        response: accepted(PaymentStartedDto),
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const user = requirePermission(req, { order: ['pay'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const phone = req.body.phoneNumber ?? user.phoneNumber;
      const card = req.body.method === 'CARD';
      const payment = await payInvoiceWithMpesa(app.prisma, {
        invoiceId: req.params.id,
        buyerOrgId: orgId,
        userId: user.id,
        phoneNumber: phone,
        card: card ? { userId: user.id, email: user.email, phoneNumber: phone, name: user.name } : undefined,
      });
      return reply.status(202).send({
        paymentId: payment.id,
        status: payment.status,
        checkoutRequestId: card ? null : payment.checkoutRequestId,
        redirectUrl: payment.redirectUrl ?? null,
        message: card
          ? 'Complete the payment on the secure card page.'
          : 'Check your phone and enter your M-Pesa PIN.',
      });
    },
  );

  r.get(
    '/v1/payouts',
    {
      schema: {
        tags: ['payments'],
        summary: 'My payouts: farmer sales, or with as=supplier green-input sales',
        querystring: PayoutQuery,
        response: ok(PayoutPageDto),
      },
    },
    async (req) => {
      const { where, held } = await payoutScope(req, req.query.as);
      const since = nairobiDayStart(`${nairobiDate(new Date()).slice(0, 7)}-01`);
      const [rows, totals, month, pending] = await Promise.all([
        app.prisma.payout.findMany({
          where,
          include: {
            order: { select: { id: true, code: true, deliveryDate: true } },
            inputOrder: { select: { id: true, total: true, product: { select: { name: true } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...cursorArgs(req.query.cursor, req.query.limit),
        }),
        app.prisma.payout.aggregate({
          where: { ...where, status: 'SUCCESS' },
          _sum: { amount: true },
          _count: true,
        }),
        app.prisma.payout.aggregate({
          where: { ...where, status: 'SUCCESS', createdAt: { gte: since } },
          _sum: { amount: true },
        }),
        app.prisma.payout.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true } }),
      ]);
      return {
        ...paginate(rows, req.query.limit),
        totalPaidCents: totals._sum.amount ?? 0,
        payoutsCount: totals._count,
        paidThisMonthCents: month._sum.amount ?? 0,
        pendingCents: pending._sum.amount ?? 0,
        heldCents: held,
      };
    },
  );
}
