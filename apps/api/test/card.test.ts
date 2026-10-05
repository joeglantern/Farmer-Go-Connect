import {
  type CardCheckoutRequest,
  type CardProvider,
  type CardStatusResult,
  MockCard,
  reconcilePayments,
  setCard,
} from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  closeApp,
  days,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

/** A provider whose every payment is declined, to exercise the failure path. */
class DecliningCard implements CardProvider {
  readonly name = 'mock' as const;
  async createCheckout(req: CardCheckoutRequest) {
    return { trackingId: `decline-${req.reference}`, redirectUrl: 'https://card.example/decline' };
  }
  async getStatus(): Promise<CardStatusResult> {
    return { status: 'FAILED', description: 'Card declined' };
  }
}

/** B13: card payments through a hosted checkout, confirmed with the provider before applying. */
describe('card payments', () => {
  let app: FastifyInstance;
  let listingId: string;
  let n = 0;

  const buyer = async () => {
    const b = await emailUser(app, undefined, `Card Buyer ${++n}`);
    await call(app, b, 'POST', '/v1/onboarding/buyer', {
      businessName: `Card Hotel ${n}`,
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    return b;
  };
  const order = async (b: Session, quantity = 2) =>
    (await call(app, b, 'POST', '/v1/orders', { listingId, quantity })).body as { id: string; total: number };

  beforeAll(async () => {
    app = await makeApp();
    setCard(new MockCard());
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Card Farmer',
      county: 'Kiambu',
      farm: { name: 'Card Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'spinach'),
        quantity: 500,
        pricePerUnit: 3050, // cents that are not whole shillings, to prove exact-cent handling
        availableFrom: days(0),
        availableTo: days(8),
      })
    ).body.id;
  });
  afterAll(async () => {
    setCard(new MockCard());
    await closeApp(app);
  });

  it('pays an order by card: hosted page, return to the app, order paid', async () => {
    const b = await buyer();
    const o = await order(b, 3);
    const pay = await call(app, b, 'POST', `/v1/orders/${o.id}/pay`, { method: 'CARD' });
    expect(pay.status).toBe(202);
    expect(pay.body.redirectUrl).toMatch(/\/dev\/card\//);
    expect(pay.body.checkoutRequestId).toBeNull();
    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    expect(payment).toMatchObject({ method: 'CARD', status: 'PENDING', amount: o.total });
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('PENDING');

    // The development stand-in page links back through the return route.
    const page = await app.inject({ method: 'GET', url: new URL(pay.body.redirectUrl).pathname });
    const back = /href="([^"]+)"/.exec(page.body)![1]!;
    const ret = await app.inject({
      method: 'GET',
      url: new URL(back.replace(/&amp;/g, '&')).pathname + new URL(back).search,
    });
    expect(ret.statusCode).toBe(302);
    expect(ret.headers.location).toBe(`farmgo://payment-return?paymentId=${payment.id}&status=SUCCESS`);
    const after = await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('SUCCESS');
    expect(after.amount).toBe(o.total); // exact cents, not rounded to shillings
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('PAID');
  });

  it('confirms an IPN with the status API, and ignores unknown ones', async () => {
    const b = await buyer();
    const o = await order(b);
    const pay = await call(app, b, 'POST', `/v1/orders/${o.id}/pay`, { method: 'CARD' });
    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    const ipn = await app.inject({
      method: 'POST',
      url: '/webhooks/pesapal',
      payload: {
        OrderTrackingId: payment.checkoutRequestId,
        OrderMerchantReference: payment.id,
        OrderNotificationType: 'IPNCHANGE',
      },
    });
    expect(ipn.json()).toMatchObject({ orderTrackingId: payment.checkoutRequestId, status: 200 });
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUCCESS',
    );
    const unknown = await app.inject({ method: 'GET', url: '/webhooks/pesapal?OrderTrackingId=nope' });
    expect(unknown.json().status).toBe(500);
  });

  it('checks out a cart by card and allocates the payment to each order', async () => {
    const b = await buyer();
    const res = await call(app, b, 'POST', '/v1/checkout', {
      items: [{ listingId, quantity: 4 }],
      deliveryDate: days(3),
      deliveryWindow: '08:00-10:00',
      paymentMethod: 'CARD',
    });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ method: 'CARD', status: 'PENDING' });
    expect(res.body.payment.redirectUrl).toMatch(/\/dev\/card\//);
    await reconcilePayments(app.prisma); // too recent: left for the buyer to finish
    await app.prisma.payment.update({
      where: { id: res.body.payment.paymentId },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    await reconcilePayments(app.prisma); // the cron confirms card payments too
    const view = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    expect(view.payment.status).toBe('SUCCESS');
    expect(view.orders[0].paymentStatus).toBe('PAID');
  });

  it('records a declined card and lets the buyer retry by M-Pesa', async () => {
    setCard(new DecliningCard());
    const b = await buyer();
    const res = await call(app, b, 'POST', '/v1/checkout', {
      items: [{ listingId, quantity: 1 }],
      deliveryDate: days(3),
      deliveryWindow: '08:00-10:00',
      paymentMethod: 'CARD',
    });
    await app.inject({
      method: 'GET',
      url: `/v1/payments/card-return?paymentId=${res.body.payment.paymentId}&app=web`,
    });
    const failed = (await call(app, b, 'GET', `/v1/checkouts/${res.body.checkoutId}`)).body;
    expect(failed.payment.status).toBe('FAILED');
    expect(failed.orders[0].paymentStatus).toBe('UNPAID');
    setCard(new MockCard());
    const retry = await call(app, b, 'POST', `/v1/checkouts/${res.body.checkoutId}/pay`, {
      method: 'MPESA',
      phoneNumber: '0712345678',
    });
    expect(retry.status).toBe(202);
    expect(retry.body.payment.redirectUrl).toBeNull();
  });
});
