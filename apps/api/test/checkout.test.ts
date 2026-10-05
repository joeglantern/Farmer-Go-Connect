import { checkStkStatus, splitDeliveryFee } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  closeApp,
  days,
  drainOutbox,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

const FEE = 30_000; // DEFAULT_DELIVERY_FEE_CENTS
const WINDOW = '08:00-10:00';

/** B07: a shop-style cart across farmers, one delivery fee, one payment. */
describe('cart and checkout', () => {
  let app: FastifyInstance;
  let admin: Session;
  const farmers: Session[] = [];
  const listings: string[] = [];
  let seq = 0;

  /** A prepaid hotel with its own phone (so each test has its own /pay rate limit). */
  async function hotel(terms?: 'NET_14') {
    const s = await emailUser(app, undefined, `Checkout Hotel ${++seq}`);
    const org = (
      await call(app, s, 'POST', '/v1/onboarding/buyer', {
        businessName: `Checkout Hotel ${seq}`,
        buyerCategory: 'HOTEL',
        county: 'Nairobi',
        lat: -1.29,
        lng: 36.82,
        address: 'Upper Hill',
      })
    ).body.organization.id;
    if (terms) {
      await call(app, admin, 'POST', `/v1/admin/orgs/${org}/verify`, {
        verified: true,
        paymentTerms: terms,
        creditLimit: 50_000_000,
      });
    }
    return s;
  }

  const base = { deliveryDate: days(3), deliveryWindow: WINDOW };

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    const plan = [
      ['Achieng', 'tomatoes', 8000],
      ['Kariuki', 'kale', 2500],
      ['Mutua', 'mangoes', 3000],
    ] as const;
    for (const [name, slug, price] of plan) {
      const f = await phoneUser(app, nextPhone());
      await call(app, f, 'POST', '/v1/onboarding/farmer', {
        name: `${name} Farmer`,
        county: 'Kiambu',
        farm: { name: `${name} Farm`, county: 'Kiambu', lat: -1.1, lng: 36.8 },
      });
      const farmId = (await call(app, f, 'GET', '/v1/farms')).body[0].id;
      const l = await call(app, f, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, slug),
        quantity: 500,
        pricePerUnit: price,
        availableFrom: days(0),
        availableTo: days(10),
      });
      farmers.push(f);
      listings.push(l.body.id);
    }
  });
  afterAll(async () => closeApp(app));

  it('splits one delivery fee by largest remainder, to the cent', () => {
    expect(splitDeliveryFee(30_000, [100, 100, 100])).toEqual([10_000, 10_000, 10_000]);
    const odd = splitDeliveryFee(10_001, [1, 1, 1]);
    expect(odd.reduce((s, v) => s + v, 0)).toBe(10_001);
    expect(splitDeliveryFee(30_000, [800_000, 50_000, 150_000])).toEqual([24_000, 1_500, 4_500]);
  });

  it('keeps a server cart per organization, priced now', async () => {
    const b = await hotel();
    await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[0], quantity: 10 });
    await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[1], quantity: 20 });
    const cart = await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[1], quantity: 25 });
    expect(cart.status).toBe(200);
    expect(cart.body.itemCount).toBe(2);
    expect(cart.body.groups).toHaveLength(2);
    expect(cart.body.subtotal).toBe(10 * 8000 + 25 * 2500);
    const removed = await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[0], quantity: 0 });
    expect(removed.body.itemCount).toBe(1);
    expect((await call(app, b, 'DELETE', '/v1/cart')).body.itemCount).toBe(0);
  });

  it('quotes a device cart: totals per farmer, one delivery fee, reduced lines flagged', async () => {
    const b = await hotel();
    const q = await call(app, b, 'POST', '/v1/checkout/quote', {
      ...base,
      items: [
        { listingId: listings[0], quantity: 10 },
        { listingId: listings[1], quantity: 9999 },
        { listingId: listings[2], quantity: 5 },
      ],
    });
    expect(q.status).toBe(200);
    expect(q.body.groups).toHaveLength(3);
    const kale = q.body.groups.flatMap((g: any) => g.items).find((i: any) => i.listingId === listings[1]);
    expect(kale).toMatchObject({ status: 'reduced', quantity: 500, requestedQuantity: 9999 });
    expect(q.body.problems).toEqual([
      expect.objectContaining({ listingId: listings[1], code: 'QUANTITY_REDUCED' }),
    ]);
    expect(q.body.deliveryFee).toBe(FEE);
    expect(q.body.total).toBe(10 * 8000 + 500 * 2500 + 5 * 3000 + FEE);
    expect(q.body.paymentMethods).toEqual(['MPESA', 'CARD']);
    expect(q.body.groups[0]).toMatchObject({ farmerFirstName: 'Achieng', county: 'Kiambu' });
  });

  it('refuses a delivery date before the cut-off allows, or an unknown window', async () => {
    const b = await hotel();
    const items = [{ listingId: listings[0], quantity: 1 }];
    const today = await call(app, b, 'POST', '/v1/checkout/quote', { ...base, items, deliveryDate: days(0) });
    expect(today.body.error.code).toBe('DELIVERY_SLOT_UNAVAILABLE');
    const odd = await call(app, b, 'POST', '/v1/checkout/quote', {
      ...base,
      items,
      deliveryWindow: '03:00-04:00',
    });
    expect(odd.body.error.code).toBe('DELIVERY_SLOT_UNAVAILABLE');
  });

  it('checks out three farmers with one M-Pesa payment and splits the fee across the orders', async () => {
    const b = await hotel();
    const items = [
      { listingId: listings[0], quantity: 10, pricePerUnit: 8000 },
      { listingId: listings[1], quantity: 20, pricePerUnit: 2500 },
      { listingId: listings[2], quantity: 30, pricePerUnit: 3000 },
    ];
    const idem = { 'idempotency-key': `co-${Date.now()}` };
    const body = { ...base, items, paymentMethod: 'MPESA', phoneNumber: '0712345678', notes: 'Kitchen door' };
    const res = await call(app, b, 'POST', '/v1/checkout', body, idem);
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(3);
    const subtotal = 10 * 8000 + 20 * 2500 + 30 * 3000;
    expect(res.body.total).toBe(subtotal + FEE);
    expect(res.body.balanceDue).toBe(subtotal + FEE);
    expect(res.body.payment).toMatchObject({ method: 'MPESA', status: 'PENDING' });
    expect(res.body.deliveryWindow).toBe(WINDOW);

    const orders = await app.prisma.order.findMany({ where: { checkoutId: res.body.checkoutId } });
    expect(orders.reduce((s, o) => s + o.deliveryFee, 0)).toBe(FEE);
    expect(new Set(orders.map((o) => o.farmerId)).size).toBe(3);
    expect(orders.every((o) => o.deliveryWindow === WINDOW && o.paymentStatus === 'PENDING')).toBe(true);

    await checkStkStatus(app.prisma, res.body.payment.paymentId);
    const paid = await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`);
    expect(paid.body.payment.status).toBe('SUCCESS');
    expect(paid.body.balanceDue).toBe(0);
    expect(paid.body.orders.every((o: any) => o.paymentStatus === 'PAID' && o.netPaid === o.total)).toBe(
      true,
    );

    // The buyer's payment list shows the checkout payment once, not its per-order shares.
    const list = await call(app, b, 'GET', '/v1/payments');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].amount).toBe(subtotal + FEE);
    const one = await call(app, b, 'GET', `/v1/orders/${orders[0]!.id}`);
    expect(one.body.payments[0].allocatedFromId).toBe(res.body.payment.paymentId);

    // A retry with the same idempotency key replays the first response instead of a second checkout.
    const replay = await call(app, b, 'POST', '/v1/checkout', body, idem);
    expect(replay.status).toBe(201);
    expect(replay.body.checkoutId).toBe(res.body.checkoutId);
    expect(replay.raw.headers['idempotent-replay']).toBe('true');
    expect(await app.prisma.checkout.count({ where: { buyerOrgId: orders[0]!.buyerOrgId } })).toBe(1);
  });

  it('refunds only the cancelled order of a paid checkout', async () => {
    const b = await hotel();
    const res = await call(app, b, 'POST', '/v1/checkout', {
      ...base,
      items: [
        { listingId: listings[0], quantity: 5 },
        { listingId: listings[1], quantity: 10 },
      ],
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    });
    await checkStkStatus(app.prisma, res.body.payment.paymentId);
    const target = res.body.orders[1];
    const cancel = await call(app, b, 'POST', `/v1/orders/${target.id}/cancel`, { reason: 'Menu changed' });
    expect(cancel.status).toBe(200);
    const view = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    const cancelled = view.orders.find((o: any) => o.id === target.id);
    const kept = view.orders.find((o: any) => o.id !== target.id);
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      refundedAmount: target.total,
    });
    expect(kept).toMatchObject({ paymentStatus: 'PAID', refundedAmount: 0 });
  });

  it('shows the refund for produce QA rejected on one order', async () => {
    const b = await hotel();
    const qa = await emailUser(app, 'qa_officer');
    const res = await call(app, b, 'POST', '/v1/checkout', {
      ...base,
      items: [{ listingId: listings[2], quantity: 40 }],
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    });
    await checkStkStatus(app.prisma, res.body.payment.paymentId);
    const orderId = res.body.orders[0].id;
    await call(app, farmers[2]!, 'POST', `/v1/orders/${orderId}/confirm`);
    await call(app, farmers[2]!, 'POST', `/v1/orders/${orderId}/ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const insp = await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'A',
      passed: true,
      acceptedQty: 30,
      rejectedQty: 10,
    });
    expect(insp.status).toBe(201);
    const view = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    expect(view.orders[0]).toMatchObject({
      total: 30 * 3000 + FEE,
      refundedAmount: 10 * 3000,
      paymentStatus: 'PARTIALLY_REFUNDED',
    });
    await drainOutbox(app);
  });

  it('refuses a stale price or vanished stock with 409 and creates nothing', async () => {
    const b = await hotel();
    const stale = await call(app, b, 'POST', '/v1/checkout', {
      ...base,
      items: [{ listingId: listings[0], quantity: 1, pricePerUnit: 7000 }],
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CHECKOUT_STOCK_CHANGED');
    expect(stale.body.error.details.problems[0]).toMatchObject({ code: 'PRICE_CHANGED' });

    // Two buyers race for the last 30 kg: exactly one checkout wins, the other gets 409.
    const farm = (await call(app, farmers[1]!, 'GET', '/v1/farms')).body[0];
    const small = (
      await call(app, farmers[1]!, 'POST', '/v1/supply', {
        farmId: farm.id,
        produceId: await produceId(app, 'spinach'),
        quantity: 30,
        pricePerUnit: 3000,
        availableFrom: days(0),
        availableTo: days(10),
      })
    ).body.id;
    const [b1, b2] = [await hotel(), await hotel()];
    const race = await Promise.all(
      [b1, b2].map((s) =>
        call(app, s, 'POST', '/v1/checkout', {
          ...base,
          items: [
            { listingId: listings[0], quantity: 1 },
            { listingId: small, quantity: 30 },
          ],
          paymentMethod: 'MPESA',
          phoneNumber: '0712345678',
        }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = race.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('CHECKOUT_STOCK_CHANGED');
    const left = await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: small } });
    expect(Number(left.quantityLeft)).toBe(0);
    // The loser's tomatoes were not reserved either (all or nothing).
    const loserOrg = await app.prisma.member.findFirstOrThrow({
      where: { userId: race.indexOf(loser) === 0 ? b1.userId : b2.userId },
    });
    expect(await app.prisma.order.count({ where: { buyerOrgId: loserOrg.organizationId } })).toBe(0);
  });

  it('lets credit-terms buyers check out on invoice with no payment', async () => {
    const prepaid = await hotel();
    const refused = await call(app, prepaid, 'POST', '/v1/checkout', {
      ...base,
      items: [{ listingId: listings[1], quantity: 2 }],
      paymentMethod: 'INVOICE',
    });
    expect(refused.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');

    const credit = await hotel('NET_14');
    const quote = await call(app, credit, 'POST', '/v1/checkout/quote', {
      ...base,
      items: [{ listingId: listings[1], quantity: 2 }],
    });
    expect(quote.body.paymentMethods).toEqual(['MPESA', 'CARD', 'INVOICE']);
    const res = await call(app, credit, 'POST', '/v1/checkout', {
      ...base,
      items: [
        { listingId: listings[0], quantity: 2 },
        { listingId: listings[1], quantity: 2 },
      ],
      paymentMethod: 'INVOICE',
    });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ method: 'INVOICE', status: 'NOT_REQUIRED', paymentId: null });
    expect(res.body.balanceDue).toBe(0);
    const orders = await app.prisma.order.findMany({ where: { checkoutId: res.body.checkoutId } });
    expect(orders.every((o) => o.paymentTerms === 'NET_14' && o.paymentStatus === 'UNPAID')).toBe(true);
  });

  it('checks out the server cart, empties it, and retries a failed M-Pesa payment', async () => {
    const b = await hotel();
    await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[1], quantity: 4 });
    // A number ending in 999 makes the mock M-Pesa fail.
    const res = await call(app, b, 'POST', '/v1/checkout', {
      ...base,
      paymentMethod: 'MPESA',
      phoneNumber: '0712000999',
    });
    expect(res.status).toBe(201);
    expect((await call(app, b, 'GET', '/v1/cart')).body.itemCount).toBe(0);
    await checkStkStatus(app.prisma, res.body.payment.paymentId);
    const failed = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    expect(failed.payment.status).toBe('FAILED');
    expect(failed.orders[0].paymentStatus).toBe('UNPAID');

    const retry = await call(app, b, 'POST', `/v1/checkouts/${res.body.checkoutId}/pay`, {
      phoneNumber: '0712345678',
    });
    expect(retry.status).toBe(202);
    expect(retry.body.payment.status).toBe('PENDING');
    await checkStkStatus(app.prisma, retry.body.payment.paymentId);
    const done = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    expect(done.payment.status).toBe('SUCCESS');
    const again = await call(app, b, 'POST', `/v1/checkouts/${res.body.checkoutId}/pay`, {});
    expect(again.body.error.code).toBe('ALREADY_PAID');
  });

  it('hides other organizations checkouts', async () => {
    const [a, other] = [await hotel(), await hotel()];
    const res = await call(app, a, 'POST', '/v1/checkout', {
      ...base,
      items: [{ listingId: listings[1], quantity: 1 }],
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    });
    expect((await call(app, other, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).status).toBe(404);
    expect((await call(app, farmers[0]!, 'GET', '/v1/cart')).status).toBe(403);
  });

  it("B17: reorders a past order into the cart at today's prices, skipping what is gone", async () => {
    const b = await hotel();
    const placed = await call(app, b, 'POST', '/v1/checkout', {
      ...base,
      items: [
        { listingId: listings[0], quantity: 3 },
        { listingId: listings[2], quantity: 4 },
      ],
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    });
    expect(placed.status).toBe(201);
    const [first, second] = placed.body.orders;
    await app.prisma.supplyListing.update({ where: { id: listings[2]! }, data: { pricePerUnit: 3500 } });
    await call(app, b, 'PUT', '/v1/cart/items', { listingId: listings[0], quantity: 1 });

    const again = await call(app, b, 'POST', `/v1/orders/${first.id}/reorder`);
    expect(again.status).toBe(200);
    expect(again.body.added).toEqual([
      { listingId: listings[0], name: 'Tomatoes', quantity: 4, reduced: false },
    ]);
    const mango = await call(app, b, 'POST', `/v1/orders/${second.id}/reorder`);
    const line = mango.body.cart.groups
      .flatMap((g: any) => g.items)
      .find((i: any) => i.listingId === listings[2]);
    expect(line.pricePerUnit).toBe(3500); // today's price, not the old one

    await app.prisma.supplyListing.update({ where: { id: listings[0]! }, data: { status: 'CANCELLED' } });
    const gone = await call(app, b, 'POST', `/v1/orders/${first.id}/reorder`);
    expect(gone.body.added).toEqual([]);
    expect(gone.body.skipped[0]).toMatchObject({ listingId: listings[0], name: 'Tomatoes' });
    await app.prisma.supplyListing.update({
      where: { id: listings[0]! },
      data: { status: 'PARTIALLY_MATCHED' },
    });

    const other = await hotel();
    expect((await call(app, other, 'POST', `/v1/orders/${first.id}/reorder`)).status).toBe(404);
  });
});
