import {
  AdminDisputeDetailDto,
  AdminInvoicePageDto,
  AdminMoneyQuery,
  AdminOrgDetailDto,
  AdminPaymentPageDto,
  IdParams,
} from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { ok, typed } from '../lib/route.js';

const CLOSED = ['PAID', 'REFUNDED', 'CANCELLED', 'QA_REJECTED'] as const;
const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'] as const;
const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'] as const;

const dateRange = (from?: Date, to?: Date) =>
  from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

/** Admin detail screens and cross-organization money lists (B28). */
export default async function adminDetailRoutes(app: FastifyInstance) {
  const r = typed(app);
  const db = app.prisma;

  r.get(
    '/v1/admin/orgs/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'One organization: profile, members and activity',
        params: IdParams,
        response: ok(AdminOrgDetailDto),
      },
    },
    async (req) => {
      requirePermission(req, { user: ['list'] });
      const org = await db.organization.findUnique({
        where: { id: req.params.id },
        include: {
          profile: true,
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, phoneNumber: true, role: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!org) throw Errors.notFound('Organization');
      const [ordersTotal, ordersOpen, demandOpen, spend, invoices, productsActive, inputOrdersTotal] =
        await Promise.all([
          db.order.count({ where: { buyerOrgId: org.id } }),
          db.order.count({ where: { buyerOrgId: org.id, status: { notIn: [...CLOSED] } } }),
          db.demandRequest.count({
            where: { buyerOrgId: org.id, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
          }),
          db.order.aggregate({
            where: { buyerOrgId: org.id, status: { notIn: ['CANCELLED', 'QA_REJECTED'] } },
            _sum: { total: true },
          }),
          db.invoice.findMany({
            where: { buyerOrgId: org.id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
            select: { total: true, amountPaid: true },
          }),
          db.inputProduct.count({ where: { supplierOrgId: org.id, active: true } }),
          db.inputOrder.count({ where: { product: { supplierOrgId: org.id } } }),
        ]);
      return {
        ...org,
        stats: {
          ordersTotal,
          ordersOpen,
          demandOpen,
          spendCents: spend._sum.total ?? 0,
          invoicesDueCents: invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0),
          productsActive,
          inputOrdersTotal,
        },
      };
    },
  );

  r.get(
    '/v1/admin/disputes/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'One dispute with its order (produce or green input) and the people involved',
        params: IdParams,
        response: ok(AdminDisputeDetailDto),
      },
    },
    async (req) => {
      requirePermission(req, { order: ['transition-any'] });
      const d = await db.dispute.findUnique({
        where: { id: req.params.id },
        include: {
          order: {
            select: {
              id: true,
              code: true,
              status: true,
              total: true,
              paymentStatus: true,
              buyerOrg: { select: { id: true, name: true } },
              farmer: { select: { id: true, name: true } },
            },
          },
          inputOrder: {
            select: {
              id: true,
              status: true,
              total: true,
              paymentStatus: true,
              product: { select: { name: true, supplierOrg: { select: { id: true, name: true } } } },
              buyer: { select: { id: true, name: true } },
            },
          },
          raisedBy: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      });
      if (!d) throw Errors.notFound('Dispute');
      return d;
    },
  );

  r.get(
    '/v1/admin/payments',
    {
      schema: {
        tags: ['admin'],
        summary: 'Payments across organizations, with totals (status, org and date filters)',
        querystring: AdminMoneyQuery,
        response: ok(AdminPaymentPageDto),
      },
    },
    async (req) => {
      // Admin-only: buyers also hold payment:read, for their own organization's payments.
      requirePermission(req, { payment: ['reconcile'] });
      const q = req.query;
      if (q.status && !(PAYMENT_STATUSES as readonly string[]).includes(q.status)) {
        throw Errors.badRequest('INVALID_STATUS', `status must be one of ${PAYMENT_STATUSES.join(', ')}`);
      }
      const where: Prisma.PaymentWhereInput = {
        // A checkout payment is listed once, not with its per-order shares.
        allocatedFromId: null,
        ...(q.status ? { status: q.status as (typeof PAYMENT_STATUSES)[number] } : {}),
        ...dateRange(q.from, q.to),
        ...(q.orgId
          ? {
              OR: [
                { order: { buyerOrgId: q.orgId } },
                { invoice: { buyerOrgId: q.orgId } },
                { checkout: { buyerOrgId: q.orgId } },
                { inputOrder: { product: { supplierOrgId: q.orgId } } },
              ],
            }
          : {}),
      };
      const [rows, collected, refunded, pending, count] = await Promise.all([
        db.payment.findMany({
          where,
          omit: { raw: true },
          include: {
            order: { select: { code: true, buyerOrg: { select: { id: true, name: true } } } },
            invoice: { select: { number: true, buyerOrg: { select: { id: true, name: true } } } },
            checkout: { select: { buyerOrg: { select: { id: true, name: true } } } },
            inputOrder: { select: { id: true, buyer: { select: { id: true, name: true } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...cursorArgs(q.cursor, q.limit),
        }),
        db.payment.aggregate({
          where: { ...where, direction: 'IN', status: 'SUCCESS' },
          _sum: { amount: true },
        }),
        db.payment.aggregate({
          where: { ...where, direction: 'OUT', status: { not: 'FAILED' } },
          _sum: { amount: true },
        }),
        db.payment.aggregate({
          where: { ...where, direction: 'IN', status: 'PENDING' },
          _sum: { amount: true },
        }),
        db.payment.count({ where }),
      ]);
      const page = paginate(rows, q.limit);
      return {
        ...page,
        items: page.items.map(({ order, invoice, checkout, inputOrder, ...p }) => {
          const org = order?.buyerOrg ?? invoice?.buyerOrg ?? checkout?.buyerOrg ?? null;
          return {
            ...p,
            payer: org
              ? { id: org.id, name: org.name, kind: 'org' as const }
              : inputOrder
                ? { id: inputOrder.buyer.id, name: inputOrder.buyer.name, kind: 'user' as const }
                : null,
            reference:
              order?.code ??
              invoice?.number ??
              (inputOrder ? `INP-${inputOrder.id.slice(-6).toUpperCase()}` : null),
          };
        }),
        totals: {
          collectedCents: collected._sum.amount ?? 0,
          refundedCents: refunded._sum.amount ?? 0,
          pendingCents: pending._sum.amount ?? 0,
          count,
        },
      };
    },
  );

  r.get(
    '/v1/admin/invoices',
    {
      schema: {
        tags: ['admin'],
        summary: 'Invoices across organizations, with totals (status, org and date filters)',
        querystring: AdminMoneyQuery,
        response: ok(AdminInvoicePageDto),
      },
    },
    async (req) => {
      // Admin-only: buyers also hold payment:read, for their own organization's payments.
      requirePermission(req, { payment: ['reconcile'] });
      const q = req.query;
      if (q.status && !(INVOICE_STATUSES as readonly string[]).includes(q.status)) {
        throw Errors.badRequest('INVALID_STATUS', `status must be one of ${INVOICE_STATUSES.join(', ')}`);
      }
      const where: Prisma.InvoiceWhereInput = {
        ...(q.status ? { status: q.status as (typeof INVOICE_STATUSES)[number] } : {}),
        ...(q.orgId ? { buyerOrgId: q.orgId } : {}),
        ...dateRange(q.from, q.to),
      };
      const [rows, sums, count] = await Promise.all([
        db.invoice.findMany({
          where,
          include: { buyerOrg: { select: { id: true, name: true } }, _count: { select: { orders: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...cursorArgs(q.cursor, q.limit),
        }),
        db.invoice.aggregate({ where, _sum: { total: true, amountPaid: true } }),
        db.invoice.count({ where }),
      ]);
      const total = sums._sum.total ?? 0;
      const paid = sums._sum.amountPaid ?? 0;
      return {
        ...paginate(rows, q.limit),
        totals: { totalCents: total, paidCents: paid, dueCents: Math.max(0, total - paid), count },
      };
    },
  );
}
