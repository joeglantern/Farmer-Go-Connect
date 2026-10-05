import {
  CartDto,
  CartItemInput,
  CheckoutInput,
  CheckoutPayInput,
  CheckoutQuoteDto,
  CheckoutQuoteInput,
  CheckoutResultDto,
  DeliverySlotsDto,
  DeliverySlotsQuery,
  IdParams,
  ReorderResultDto,
} from '@farmgo/contracts';
import {
  AppError,
  type BuyerContext,
  checkoutView,
  deliverySlots,
  Errors,
  logger,
  payCheckoutWithMpesa,
  placeCheckout,
  priceLines,
  quoteCheckout,
  resolveItems,
} from '@farmgo/core';
import { num } from '@farmgo/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireOrg, requirePermission } from '../lib/guards.js';
import { accepted, created, ok, typed } from '../lib/route.js';

/** The buyer organization the caller shops for. */
async function buyerContext(
  req: FastifyRequest,
): Promise<BuyerContext & { phoneNumber: string | null; email: string; name: string }> {
  const user = requirePermission(req, { order: ['create'] });
  const { orgId, profile } = await requireOrg(req, 'BUYER');
  return {
    buyerOrgId: orgId,
    userId: user.id,
    paymentTerms: profile.paymentTerms,
    profileAddress: profile.address,
    profileLat: profile.lat,
    profileLng: profile.lng,
    phoneNumber: user.phoneNumber ?? null,
    email: user.email,
    name: user.name,
  };
}

/**
 * Shop-style buying (B07): a server cart that follows the user across devices, a quote with one
 * delivery fee, and a checkout that places one order per farmer and takes one payment.
 */
export default async function checkoutRoutes(app: FastifyInstance) {
  const r = typed(app);

  const cartView = async (ctx: BuyerContext) => {
    const items = await resolveItems(app.prisma, ctx.buyerOrgId);
    const priced = await priceLines(app.prisma, { items, userId: ctx.userId });
    return {
      groups: priced.groups,
      subtotal: priced.subtotal,
      itemCount: items.length,
      problems: priced.problems,
    };
  };

  r.get(
    '/v1/delivery/slots',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Delivery dates and windows that can be booked now (next-day cut-off applies)',
        querystring: DeliverySlotsQuery,
        response: ok(DeliverySlotsDto),
      },
    },
    async (req) => deliverySlots(app.prisma, { from: req.query.from, days: req.query.days }),
  );

  r.get(
    '/v1/cart',
    {
      schema: {
        tags: ['checkout'],
        summary: 'My cart, priced now, grouped by farmer (never reserves stock)',
        response: ok(CartDto),
      },
    },
    async (req) => cartView(await buyerContext(req)),
  );

  r.put(
    '/v1/cart/items',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Set the quantity of one listing in the cart (0 removes it)',
        body: CartItemInput,
        response: ok(CartDto),
      },
    },
    async (req) => {
      const ctx = await buyerContext(req);
      const { listingId, quantity } = req.body;
      if (quantity === 0) {
        await app.prisma.cartItem.deleteMany({ where: { buyerOrgId: ctx.buyerOrgId, listingId } });
      } else {
        const listing = await app.prisma.supplyListing.findUnique({ where: { id: listingId } });
        if (!listing || listing.status === 'DRAFT') throw Errors.notFound('Listing');
        await app.prisma.cartItem.upsert({
          where: { buyerOrgId_listingId: { buyerOrgId: ctx.buyerOrgId, listingId } },
          create: { buyerOrgId: ctx.buyerOrgId, listingId, quantity },
          update: { quantity },
        });
      }
      return cartView(ctx);
    },
  );

  r.delete(
    '/v1/cart',
    { schema: { tags: ['checkout'], summary: 'Empty the cart', response: ok(CartDto) } },
    async (req) => {
      const ctx = await buyerContext(req);
      await app.prisma.cartItem.deleteMany({ where: { buyerOrgId: ctx.buyerOrgId } });
      return cartView(ctx);
    },
  );

  r.post(
    '/v1/orders/:id/reorder',
    {
      schema: {
        tags: ['checkout'],
        summary: "Put a past order's items back in the cart at today's prices",
        params: IdParams,
        response: ok(ReorderResultDto),
      },
    },
    async (req) => {
      const ctx = await buyerContext(req);
      const order = await app.prisma.order.findUnique({
        where: { id: req.params.id },
        include: {
          items: {
            include: { listing: { include: { produce: true, farm: { include: { farmer: true } } } } },
          },
        },
      });
      if (!order || order.buyerOrgId !== ctx.buyerOrgId) throw Errors.notFound('Order');
      const added: { listingId: string; name: string; quantity: number; reduced: boolean }[] = [];
      const skipped: { listingId: string; name: string; reason: string }[] = [];
      const now = new Date();
      for (const item of order.items) {
        const l = item.listing;
        const name = l.produce.name;
        const left = num(l.quantityLeft);
        if (l.farm.farmer.userId === ctx.userId) {
          skipped.push({ listingId: l.id, name, reason: 'This is your own produce' });
          continue;
        }
        if (!['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) || l.availableTo < now || left <= 0) {
          skipped.push({
            listingId: l.id,
            name,
            reason: `${name} from ${l.farm.name} is no longer available`,
          });
          continue;
        }
        const existing = await app.prisma.cartItem.findUnique({
          where: { buyerOrgId_listingId: { buyerOrgId: ctx.buyerOrgId, listingId: l.id } },
        });
        const wanted = num(item.quantity) + (existing ? num(existing.quantity) : 0);
        const quantity = Math.min(wanted, left);
        await app.prisma.cartItem.upsert({
          where: { buyerOrgId_listingId: { buyerOrgId: ctx.buyerOrgId, listingId: l.id } },
          create: { buyerOrgId: ctx.buyerOrgId, listingId: l.id, quantity },
          update: { quantity },
        });
        added.push({ listingId: l.id, name, quantity, reduced: quantity < wanted });
      }
      return { cart: await cartView(ctx), added, skipped };
    },
  );

  r.post(
    '/v1/checkout/quote',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Price a cart for a delivery date and window: totals per farmer, one delivery fee',
        description: 'Send `items` for a device cart, or omit them to quote the server cart.',
        body: CheckoutQuoteInput,
        response: ok(CheckoutQuoteDto),
      },
    },
    async (req) => quoteCheckout(app.prisma, await buyerContext(req), req.body),
  );

  r.post(
    '/v1/checkout',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Place the cart: one order per farmer, one payment for everything',
        description:
          'All or nothing: if stock or a price changed since the quote, nothing is created and the ' +
          'response is 409 CHECKOUT_STOCK_CHANGED with `details.problems`. Send an Idempotency-Key.',
        body: CheckoutInput,
        response: created(CheckoutResultDto),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const ctx = await buyerContext(req);
      const phone = req.body.phoneNumber ?? ctx.phoneNumber;
      if (req.body.paymentMethod === 'MPESA' && !phone) {
        throw Errors.badRequest('PHONE_REQUIRED', 'Enter the M-Pesa number to charge');
      }
      const { checkout } = await placeCheckout(app.prisma, ctx, req.body);
      let message: string | undefined;
      if (req.body.paymentMethod === 'MPESA' || req.body.paymentMethod === 'CARD') {
        const card = req.body.paymentMethod === 'CARD';
        try {
          await payCheckoutWithMpesa(app.prisma, {
            checkoutId: checkout.id,
            buyerOrgId: ctx.buyerOrgId,
            userId: ctx.userId,
            phoneNumber: phone,
            card: card
              ? { userId: ctx.userId, email: ctx.email, phoneNumber: phone, name: ctx.name }
              : undefined,
          });
          message = card
            ? 'Complete the payment on the secure card page.'
            : 'Check your phone and enter your M-Pesa PIN to complete payment.';
        } catch (err) {
          // The orders exist; the buyer can retry payment with POST /v1/checkouts/:id/pay.
          logger.warn({ err, checkoutId: checkout.id }, 'checkout: STK push failed');
          message = err instanceof AppError ? err.message : 'M-Pesa is not responding. Try again shortly.';
        }
      }
      const view = await checkoutView(app.prisma, checkout.id);
      return reply
        .status(201)
        .send({ ...view, payment: { ...view.payment, ...(message ? { message } : {}) } });
    },
  );

  const loadCheckout = async (req: FastifyRequest, id: string) => {
    const ctx = await buyerContext(req);
    const checkout = await app.prisma.checkout.findUnique({ where: { id } });
    if (!checkout || checkout.buyerOrgId !== ctx.buyerOrgId) throw Errors.notFound('Checkout');
    return { ctx, checkout };
  };

  r.get(
    '/v1/checkouts/:id',
    {
      schema: {
        tags: ['checkout'],
        summary: 'A checkout: its orders, payment status and any refunds (poll while paying)',
        params: IdParams,
        response: ok(CheckoutResultDto),
      },
    },
    async (req) => {
      const { checkout } = await loadCheckout(req, req.params.id);
      return checkoutView(app.prisma, checkout.id);
    },
  );

  r.post(
    '/v1/checkouts/:id/pay',
    {
      schema: {
        tags: ['checkout'],
        summary: 'Try the payment again (a fresh M-Pesa prompt for what is still due)',
        params: IdParams,
        body: CheckoutPayInput,
        response: accepted(CheckoutResultDto),
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { ctx, checkout } = await loadCheckout(req, req.params.id);
      if (checkout.paymentMethod === 'INVOICE') {
        throw Errors.badRequest('PAYMENT_METHOD_UNAVAILABLE', 'This checkout is billed on your invoice');
      }
      const card = (req.body.method ?? checkout.paymentMethod) === 'CARD';
      const phone = req.body.phoneNumber ?? ctx.phoneNumber;
      await payCheckoutWithMpesa(app.prisma, {
        checkoutId: checkout.id,
        buyerOrgId: ctx.buyerOrgId,
        userId: ctx.userId,
        phoneNumber: phone,
        card: card ? { userId: ctx.userId, email: ctx.email, phoneNumber: phone, name: ctx.name } : undefined,
      });
      const view = await checkoutView(app.prisma, checkout.id);
      return reply.status(202).send({
        ...view,
        payment: {
          ...view.payment,
          message: card
            ? 'Complete the payment on the secure card page.'
            : 'Check your phone and enter your M-Pesa PIN to complete payment.',
        },
      });
    },
  );
}
