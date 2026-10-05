import {
  DisputeDto,
  IdParams,
  InputOrderCreatedDto,
  InputOrderDto,
  InputOrderInput,
  InputOrderPageDto,
  InputOrderQuery,
  InputOrderTransitionInput,
  InputProductDto,
  InputProductInput,
  InputProductListItemDto,
  InputProductPageDto,
  InputProductQuery,
  InputProductUpdate,
  PaymentStartedDto,
  PayOrderInput,
  RaiseDisputeInput,
} from '@farmgo/contracts';
import {
  AppError,
  Errors,
  emit,
  lineTotal,
  logger,
  payInputOrderWithMpesa,
  raiseInputDispute,
  transitionInputOrder,
} from '@farmgo/core';
import { num } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { requireOrg, requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { accepted, created, ok, typed } from '../lib/route.js';
import { assertOwnKeys } from './uploads.routes.js';

/**
 * Green inputs marketplace: youth enterprises sell compost, organic fertiliser, seedlings,
 * biopesticides and packaging to farmers.
 */
export default async function inputRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/inputs',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Browse green inputs',
        querystring: InputProductQuery,
        response: ok(InputProductPageDto),
      },
    },
    async (req) => {
      requirePermission(req, { input: ['buy'] });
      const q = req.query;
      // Suppliers managing their catalog see their own products, active or not.
      const mine = q.mine
        ? { supplierOrgId: (await requireOrg(req, 'INPUT_SUPPLIER')).orgId }
        : { active: true };
      const rows = await app.prisma.inputProduct.findMany({
        where: {
          ...mine,
          ...(q.category ? { category: q.category } : {}),
          ...(q.county ? { county: q.county } : {}),
          ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
        },
        include: { supplierOrg: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.get(
    '/v1/inputs/:id',
    {
      schema: {
        tags: ['inputs'],
        summary: 'One green-input product',
        params: IdParams,
        response: ok(InputProductListItemDto),
      },
    },
    async (req) => {
      requirePermission(req, { input: ['buy'] });
      const p = await app.prisma.inputProduct.findUnique({
        where: { id: req.params.id },
        include: { supplierOrg: { select: { id: true, name: true } } },
      });
      if (!p) throw Errors.notFound('Product');
      return p;
    },
  );

  r.post(
    '/v1/inputs',
    {
      schema: {
        tags: ['inputs'],
        summary: 'List a product (supplier)',
        body: InputProductInput,
        response: created(InputProductDto),
      },
    },
    async (req, reply) => {
      requirePermission(req, { input: ['sell'] });
      const { orgId } = await requireOrg(req, 'INPUT_SUPPLIER');
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const p = await app.prisma.inputProduct.create({ data: { ...req.body, supplierOrgId: orgId } });
      return reply.status(201).send(p);
    },
  );

  r.patch(
    '/v1/inputs/:id',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Edit a product (supplier)',
        params: IdParams,
        body: InputProductUpdate,
        response: ok(InputProductDto),
      },
    },
    async (req) => {
      requirePermission(req, { input: ['sell'] });
      const { orgId } = await requireOrg(req, 'INPUT_SUPPLIER');
      const p = await app.prisma.inputProduct.findUnique({ where: { id: req.params.id } });
      if (!p || p.supplierOrgId !== orgId) throw Errors.notFound('Product');
      if (req.body.photos?.length) await assertOwnKeys(req, req.body.photos);
      return app.prisma.inputProduct.update({ where: { id: p.id }, data: req.body });
    },
  );

  r.post(
    '/v1/inputs/:id/order',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Order a green input',
        params: IdParams,
        body: InputOrderInput,
        response: created(InputOrderCreatedDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { input: ['buy'] });
      const order = await app.prisma.$transaction(async (tx) => {
        const p = await tx.inputProduct.findUnique({ where: { id: req.params.id } });
        if (!p?.active) throw Errors.notFound('Product');
        const ownProduct = await tx.member.findFirst({
          where: { organizationId: p.supplierOrgId, userId: user.id },
        });
        if (ownProduct) throw Errors.badRequest('SELF_ORDER', 'You cannot order your own product');
        // Reserve stock atomically.
        const reserved = await tx.inputProduct.updateMany({
          where: { id: p.id, stock: { gte: req.body.quantity } },
          data: { stock: { decrement: req.body.quantity } },
        });
        if (reserved.count !== 1)
          throw new AppError('OUT_OF_STOCK', `Only ${num(p.stock)} ${p.unit.toLowerCase()} left`, 409);
        const o = await tx.inputOrder.create({
          data: {
            productId: p.id,
            buyerId: user.id,
            quantity: req.body.quantity,
            pricePerUnit: p.pricePerUnit,
            total: lineTotal(req.body.quantity, p.pricePerUnit),
            deliveryNote: req.body.deliveryNote,
          },
          include: { product: true },
        });
        await emit(
          tx,
          'input_order.created',
          { inputOrderId: o.id, supplierOrgId: p.supplierOrgId, buyerId: user.id },
          o.id,
        );
        return o;
      });
      // Pay now by M-Pesa; the money is held until the goods arrive (like produce orders).
      let payment: { paymentId: string | null; status: 'PENDING' | 'FAILED'; message: string };
      try {
        const pay = await payInputOrderWithMpesa(app.prisma, {
          inputOrderId: order.id,
          userId: user.id,
          phoneNumber: req.body.phoneNumber ?? user.phoneNumber,
        });
        payment = {
          paymentId: pay.id,
          status: 'PENDING',
          message: 'Check your phone and enter your M-Pesa PIN to complete payment.',
        };
      } catch (err) {
        logger.warn({ err, inputOrderId: order.id }, 'input order: STK push failed');
        payment = {
          paymentId: null,
          status: 'FAILED',
          message: err instanceof AppError ? err.message : 'M-Pesa is not responding. Try again shortly.',
        };
      }
      const fresh = await app.prisma.inputOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { product: true },
      });
      return reply.status(201).send({ ...fresh, payment });
    },
  );

  r.post(
    '/v1/input-orders/:id/pay',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Pay (or retry paying) a green-input order with M-Pesa',
        params: IdParams,
        body: PayOrderInput,
        response: accepted(PaymentStartedDto),
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const user = requirePermission(req, { input: ['buy'] });
      const payment = await payInputOrderWithMpesa(app.prisma, {
        inputOrderId: req.params.id,
        userId: user.id,
        phoneNumber: req.body.phoneNumber ?? user.phoneNumber,
      });
      return reply.status(202).send({
        paymentId: payment.id,
        status: payment.status,
        checkoutRequestId: payment.checkoutRequestId,
        message: 'Check your phone and enter your M-Pesa PIN to complete payment.',
      });
    },
  );

  r.post(
    '/v1/input-orders/:id/dispute',
    {
      schema: {
        tags: ['inputs'],
        summary: "Report a problem within the window after dispatch; holds the supplier's payout",
        params: IdParams,
        body: RaiseDisputeInput,
        response: created(DisputeDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { input: ['buy'] });
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const d = await raiseInputDispute(app.prisma, {
        inputOrderId: req.params.id,
        userId: user.id,
        ...req.body,
      });
      return reply.status(201).send(d);
    },
  );

  r.get(
    '/v1/input-orders',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Input orders I placed, or received as a supplier (as=seller|buyer to pick one)',
        querystring: InputOrderQuery,
        response: ok(InputOrderPageDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { input: ['buy'] });
      const supplierOrgs = await app.prisma.member.findMany({
        where: { userId: user.id, organization: { profile: { type: 'INPUT_SUPPLIER' } } },
        select: { organizationId: true },
      });
      const rows = await app.prisma.inputOrder.findMany({
        where: {
          OR: [
            ...(req.query.as === 'seller' ? [] : [{ buyerId: user.id }]),
            ...(req.query.as === 'buyer'
              ? []
              : [{ product: { supplierOrgId: { in: supplierOrgs.map((s) => s.organizationId) } } }]),
          ],
        },
        include: {
          product: { select: { id: true, name: true, unit: true, supplierOrgId: true } },
          buyer: { select: { id: true, name: true, phoneNumber: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.post(
    '/v1/input-orders/:id/transition',
    {
      schema: {
        tags: ['inputs'],
        summary: 'Accept, dispatch, deliver, reject or cancel an input order',
        params: IdParams,
        body: InputOrderTransitionInput,
        response: ok(InputOrderDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { input: ['buy'] });
      return transitionInputOrder(app.prisma, {
        inputOrderId: req.params.id,
        userId: user.id,
        to: req.body.to,
      });
    },
  );
}
