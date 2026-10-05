import {
  ACTIVE_ORDER_STATUSES,
  allowedTransitions,
  CancelOrderInput,
  CreateOrderInput,
  DisputeDto,
  IdParams,
  MessageDto,
  MessageInput,
  MessageListDto,
  OrderDetailDto,
  OrderDto,
  OrderPageDto,
  OrderQuery,
  type OrderStatus,
  PaymentStartedDto,
  PayOrderInput,
  RaiseDisputeInput,
  ReviewDto,
  ReviewInput,
  TrackingDto,
  TransitionInput,
} from '@farmgo/contracts';
import {
  assertNotPast,
  confirmReceipt,
  createOrder,
  Errors,
  emit,
  getSetting,
  payOrderWithMpesa,
  raiseDispute,
  transitionOrder,
} from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { requireOrg, requirePermission, requireUser, roleOf } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { accepted, created, ok, typed } from '../lib/route.js';
import { actorFor, loadOrder, orderScope } from './order-access.js';
import { assertOwnKeys } from './uploads.routes.js';

export default async function orderRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/orders',
    {
      schema: {
        tags: ['orders'],
        summary: 'Orders visible to me',
        querystring: OrderQuery,
        response: ok(OrderPageDto),
      },
    },
    async (req) => {
      const q = req.query;
      const scope = await orderScope(req);
      const rows = await app.prisma.order.findMany({
        where: {
          ...scope,
          AND: [
            q.status ? { status: q.status } : {},
            q.scope === 'active' ? { status: { in: [...ACTIVE_ORDER_STATUSES] } } : {},
            q.scope === 'past' ? { status: { notIn: [...ACTIVE_ORDER_STATUSES] } } : {},
          ],
          ...(q.from || q.to
            ? { deliveryDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
            : {}),
        },
        include: {
          items: { include: { listing: { include: { produce: true } } } },
          buyerOrg: { select: { id: true, name: true } },
          farmer: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.get(
    '/v1/orders/:id',
    {
      schema: {
        tags: ['orders'],
        summary: 'Order detail: items, history, stops, payments and allowed actions',
        params: IdParams,
        response: ok(OrderDetailDto),
      },
    },
    async (req) => {
      const { order, viewer } = await loadOrder(req, req.params.id);
      const full = await app.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: {
            include: {
              listing: {
                include: { produce: true, farm: { select: { name: true, county: true, ward: true } } },
              },
              inspection: true,
            },
          },
          events: { orderBy: { createdAt: 'asc' } },
          buyerOrg: {
            select: {
              id: true,
              name: true,
              profile: { select: { county: true, town: true, address: true, buyerCategory: true } },
            },
          },
          farmer: { select: { id: true, name: true } },
          stops: { orderBy: { sequence: 'asc' } },
          payments: { orderBy: { createdAt: 'desc' } },
          payout: viewer !== 'buyer',
          disputes: true,
          reviews: true,
          route: {
            select: {
              id: true,
              code: true,
              status: true,
              driver: { select: { id: true, name: true, phoneNumber: true } },
            },
          },
        },
      });
      const seesPayerPhone = viewer === 'buyer' || viewer === 'admin';
      return {
        ...full,
        payments: seesPayerPhone ? full.payments : full.payments.map((p) => ({ ...p, phoneNumber: null })),
        viewer,
        allowedTransitions: allowedTransitions(order.status as OrderStatus, actorFor(viewer)),
      };
    },
  );

  r.post(
    '/v1/orders',
    {
      schema: {
        tags: ['orders'],
        summary: 'Order directly from a listing',
        body: CreateOrderInput,
        response: created(OrderDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { order: ['create'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      if (req.body.deliveryDate) assertNotPast(req.body.deliveryDate, 'deliveryDate');
      if (req.body.deliveryWindow) {
        const windows = await getSetting(app.prisma, 'deliveryWindows');
        if (!windows.includes(req.body.deliveryWindow)) {
          throw Errors.badRequest(
            'DELIVERY_SLOT_UNAVAILABLE',
            `Choose one of the delivery windows: ${windows.join(', ')}`,
          );
        }
      }
      const order = await app.prisma.$transaction((tx) =>
        createOrder(tx, { ...req.body, buyerOrgId: orgId, createdById: user.id }),
      );
      return reply.status(201).send(order);
    },
  );

  const transition = async (
    orderId: string,
    to: OrderStatus,
    note: string | undefined,
    req: Parameters<typeof loadOrder>[0],
  ) => {
    const { order, viewer } = await loadOrder(req, orderId);
    const user = requireUser(req);
    return app.prisma.$transaction((tx) =>
      transitionOrder(tx, {
        orderId: order.id,
        to,
        actor: actorFor(viewer),
        actorId: user.id,
        note,
        expectedVersion: order.version,
      }),
    );
  };

  r.post(
    '/v1/orders/:id/confirm',
    {
      schema: {
        tags: ['orders'],
        summary: 'Farmer confirms a new order',
        params: IdParams,
        response: ok(OrderDto),
      },
    },
    async (req) => transition(req.params.id, 'CONFIRMED', 'Confirmed by farmer', req),
  );

  r.post(
    '/v1/orders/:id/ready',
    {
      schema: {
        tags: ['orders'],
        summary: 'Farmer marks the order harvested and ready for inspection',
        params: IdParams,
        response: ok(OrderDto),
      },
    },
    async (req) => transition(req.params.id, 'READY_FOR_QA', 'Harvest ready', req),
  );

  r.post(
    '/v1/orders/:id/cancel',
    {
      schema: {
        tags: ['orders'],
        summary: 'Cancel an order that has not been inspected yet',
        params: IdParams,
        body: CancelOrderInput,
        response: ok(OrderDto),
      },
    },
    async (req) => transition(req.params.id, 'CANCELLED', req.body.reason, req),
  );

  r.post(
    '/v1/orders/:id/transition',
    {
      schema: {
        tags: ['orders'],
        summary: 'Move an order to another status (validated by the state machine)',
        params: IdParams,
        body: TransitionInput,
        response: ok(OrderDto),
      },
    },
    async (req) => {
      // Some statuses carry records the generic endpoint cannot create: a dispute needs a Dispute
      // row admins resolve, and QA results need an inspection (accepted quantity, photos).
      if (req.body.to === 'DISPUTED') {
        throw Errors.conflict('USE_DISPUTE_ENDPOINT', 'Raise a dispute with POST /v1/orders/:id/dispute');
      }
      if (req.body.to === 'QA_PASSED' || req.body.to === 'QA_REJECTED') {
        // Admins keep a manual override (audit-logged by transitionOrder); everyone else inspects.
        if (roleOf(requireUser(req)) !== 'admin') {
          throw Errors.conflict(
            'USE_INSPECTION_ENDPOINT',
            'Record the inspection with POST /v1/qa/inspections',
          );
        }
      }
      return transition(req.params.id, req.body.to, req.body.note, req);
    },
  );

  r.post(
    '/v1/orders/:id/pay',
    {
      schema: {
        tags: ['payments'],
        summary: 'Pay a prepaid order by M-Pesa (STK push) or card (hosted checkout)',
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
      const payment = await payOrderWithMpesa(app.prisma, {
        orderId: req.params.id,
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
          : 'Check your phone and enter your M-Pesa PIN to complete payment.',
      });
    },
  );

  r.post(
    '/v1/orders/:id/confirm-receipt',
    {
      schema: {
        tags: ['orders'],
        summary: 'Buyer confirms the delivery was fine, releasing payment to the farmer',
        params: IdParams,
        response: ok(OrderDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { order: ['dispute'] });
      const { order, viewer } = await loadOrder(req, req.params.id);
      if (viewer !== 'buyer' && viewer !== 'admin')
        throw Errors.forbidden('Only the buyer can confirm receipt');
      await app.prisma.$transaction((tx) => confirmReceipt(tx, order.id, user.id));
      return app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    },
  );

  r.post(
    '/v1/orders/:id/dispute',
    {
      schema: {
        tags: ['orders'],
        summary: 'Report a problem with a delivered order',
        params: IdParams,
        body: RaiseDisputeInput,
        response: created(DisputeDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { order: ['dispute'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const d = await raiseDispute(app.prisma, {
        orderId: req.params.id,
        buyerOrgId: orgId,
        userId: user.id,
        ...req.body,
      });
      return reply.status(201).send(d);
    },
  );

  r.post(
    '/v1/orders/:id/review',
    {
      schema: {
        tags: ['orders'],
        summary: 'Rate the other side after delivery',
        params: IdParams,
        body: ReviewInput,
        response: created(ReviewDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { order: ['review'] });
      const { order, viewer } = await loadOrder(req, req.params.id);
      if (!['DELIVERED', 'PAID'].includes(order.status))
        throw Errors.conflict('ORDER_NOT_DELIVERED', 'You can review once the order is delivered');
      if (viewer !== 'buyer' && viewer !== 'farmer')
        throw Errors.forbidden('Only the buyer and farmer can review an order');
      const review = await app.prisma.review.create({
        data: {
          orderId: order.id,
          authorId: user.id,
          rating: req.body.rating,
          comment: req.body.comment,
          ...(viewer === 'buyer' ? { targetUserId: order.farmerId } : { targetOrgId: order.buyerOrgId }),
        },
      });
      return reply.status(201).send(review);
    },
  );

  r.get(
    '/v1/orders/:id/messages',
    {
      schema: {
        tags: ['orders'],
        summary: 'Chat thread for an order',
        params: IdParams,
        response: ok(MessageListDto),
      },
    },
    async (req) => {
      const { order } = await loadOrder(req, req.params.id);
      return app.prisma.orderMessage.findMany({
        where: { orderId: order.id },
        include: { author: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
    },
  );

  r.post(
    '/v1/orders/:id/messages',
    {
      schema: {
        tags: ['orders'],
        summary: 'Message the other side about this order',
        params: IdParams,
        body: MessageInput,
        response: created(MessageDto),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { order } = await loadOrder(req, req.params.id);
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const msg = await app.prisma.$transaction(async (tx) => {
        const m = await tx.orderMessage.create({
          data: { orderId: order.id, authorId: user.id, body: req.body.body, photos: req.body.photos },
          include: { author: { select: { id: true, name: true, role: true } } },
        });
        await emit(
          tx,
          'order.message',
          {
            orderId: order.id,
            messageId: m.id,
            authorId: user.id,
            buyerOrgId: order.buyerOrgId,
            farmerId: order.farmerId,
          },
          order.id,
        );
        return m;
      });
      return reply.status(201).send(msg);
    },
  );

  r.get(
    '/v1/orders/:id/tracking',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Live delivery tracking for an order',
        params: IdParams,
        response: ok(TrackingDto),
      },
    },
    async (req) => {
      const { order } = await loadOrder(req, req.params.id);
      const when = { deliveryDate: order.deliveryDate, deliveryWindow: order.deliveryWindow };
      if (!order.routeId) return { route: null, stops: [], lastLocation: null, ...when };
      const [route, stops, lastLocation] = await Promise.all([
        app.prisma.route.findUnique({
          where: { id: order.routeId },
          select: {
            id: true,
            code: true,
            status: true,
            driver: { select: { name: true, phoneNumber: true } },
          },
        }),
        app.prisma.delivery.findMany({ where: { orderId: order.id }, orderBy: { sequence: 'asc' } }),
        app.prisma.driverLocation.findFirst({
          where: { routeId: order.routeId },
          orderBy: { recordedAt: 'desc' },
        }),
      ]);
      const stillMoving = route?.status === 'IN_PROGRESS';
      return { route, stops, lastLocation: stillMoving ? lastLocation : null, ...when };
    },
  );
}
