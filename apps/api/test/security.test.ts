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

async function onboardBuyer(app: FastifyInstance, s: Session, name: string) {
  const r = await call(app, s, 'POST', '/v1/onboarding/buyer', {
    businessName: name,
    buyerCategory: 'RESTAURANT',
    county: 'Nairobi',
  });
  expect(r.status).toBe(201);
  return r.body.organization.id as string;
}

async function onboardFarmerWithListing(app: FastifyInstance, s: Session, qty = 500) {
  await call(app, s, 'POST', '/v1/onboarding/farmer', {
    name: 'John Kariuki',
    county: 'Kiambu',
    farm: { name: 'Kariuki Farm', county: 'Kiambu', lat: -1.05, lng: 36.9 },
  });
  const farm = (await call(app, s, 'GET', '/v1/farms')).body[0];
  const listing = await call(app, s, 'POST', '/v1/supply', {
    farmId: farm.id,
    produceId: await produceId(app, 'potatoes'),
    quantity: qty,
    pricePerUnit: 5500,
    availableFrom: days(0),
    availableTo: days(7),
  });
  expect(listing.status).toBe(201);
  return { farmId: farm.id as string, listingId: listing.body.id as string };
}

describe('access control and safety rules', () => {
  let app: FastifyInstance;
  let buyerA: Session;
  let buyerB: Session;
  let farmer: Session;
  let listingId: string;
  let farmId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyerA = await emailUser(app);
    buyerB = await emailUser(app);
    farmer = await phoneUser(app, nextPhone());
    await onboardBuyer(app, buyerA, 'Buyer A');
    await onboardBuyer(app, buyerB, 'Buyer B');
    ({ listingId, farmId } = await onboardFarmerWithListing(app, farmer));
  });
  afterAll(async () => closeApp(app));

  it('rejects unauthenticated requests', async () => {
    const r = await call(app, null, 'GET', '/v1/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
    expect(r.body.error.requestId).toBeTruthy();
  });

  it('stops farmers from acting as buyers', async () => {
    const r = await call(app, farmer, 'POST', '/v1/demand', {
      produceId: await produceId(app, 'kale'),
      quantity: 10,
      neededBy: days(3),
    });
    expect(r.status).toBe(403);
  });

  it('lets an account choose its role only once', async () => {
    const r = await call(app, farmer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Sneaky',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ROLE_ALREADY_SET');
  });

  it('returns field-level validation errors', async () => {
    const r = await call(app, buyerA, 'POST', '/v1/demand', {
      produceId: 'x',
      quantity: -5,
      neededBy: 'not a date',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('hides other organizations orders (404, not 403)', async () => {
    const order = await call(app, buyerA, 'POST', '/v1/orders', { listingId, quantity: 10 });
    expect(order.status).toBe(201);
    const peek = await call(app, buyerB, 'GET', `/v1/orders/${order.body.id}`);
    expect(peek.status).toBe(404);
    const cancel = await call(app, buyerB, 'POST', `/v1/orders/${order.body.id}/cancel`, {
      reason: 'not mine',
    });
    expect(cancel.status).toBe(404);
  });

  it('shows buyers only the farmer first name, never contact details', async () => {
    const r = await call(app, buyerA, 'GET', `/v1/supply/${listingId}`);
    expect(r.body.farm.farmer.user.name).toBe('John');
    expect(JSON.stringify(r.body)).not.toMatch(/\+2547/);
  });

  it('enforces the order state machine', async () => {
    const order = await call(app, buyerA, 'POST', '/v1/orders', { listingId, quantity: 5 });
    const skip = await call(app, buyerA, 'POST', `/v1/orders/${order.body.id}/transition`, {
      to: 'DELIVERED',
    });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(skip.body.error.details.allowed).toEqual(['CANCELLED']);
    const buyerConfirm = await call(app, buyerA, 'POST', `/v1/orders/${order.body.id}/confirm`);
    expect(buyerConfirm.status).toBe(409);
    const farmerConfirm = await call(app, farmer, 'POST', `/v1/orders/${order.body.id}/confirm`);
    expect(farmerConfirm.body.status).toBe('CONFIRMED');
  });

  it('returns cancelled quantity to the listing', async () => {
    const before = Number(
      (await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: listingId } })).quantityLeft,
    );
    const order = await call(app, buyerA, 'POST', '/v1/orders', { listingId, quantity: 20 });
    expect(
      Number((await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: listingId } })).quantityLeft),
    ).toBe(before - 20);
    await call(app, buyerA, 'POST', `/v1/orders/${order.body.id}/cancel`, { reason: 'Menu changed' });
    expect(
      Number((await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: listingId } })).quantityLeft),
    ).toBe(before);
  });

  it('never oversells a listing under concurrent orders', async () => {
    const { listingId: small } = await (async () => {
      const farm = farmId;
      const l = await call(app, farmer, 'POST', '/v1/supply', {
        farmId: farm,
        produceId: await produceId(app, 'carrots'),
        quantity: 100,
        pricePerUnit: 6000,
        availableFrom: days(0),
        availableTo: days(5),
      });
      return { listingId: l.body.id as string };
    })();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(app, buyerA, 'POST', '/v1/orders', { listingId: small, quantity: 30 }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(3);
    expect(refused).toBe(2);
    const listing = await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: small } });
    expect(Number(listing.quantityLeft)).toBe(10);
  });

  it('replays a retried write with the same idempotency key instead of repeating it', async () => {
    const payload = { name: 'Second plot', county: 'Kiambu' };
    const headers = { 'idempotency-key': 'offline-sync-123' };
    const a = await call(app, farmer, 'POST', '/v1/farms', payload, headers);
    const b = await call(app, farmer, 'POST', '/v1/farms', payload, headers);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.raw.headers['idempotent-replay']).toBe('true');
    const farms = await call(app, farmer, 'GET', '/v1/farms');
    expect(farms.body.filter((f: { name: string }) => f.name === 'Second plot')).toHaveLength(1);
  });

  it('refuses to attach files uploaded by someone else', async () => {
    const r = await call(app, buyerA, 'PATCH', '/v1/me', { image: `avatars/${farmer.userId}/x.jpg` });
    expect(r.status).toBe(403);
  });

  it('rejects M-Pesa callbacks without the shared secret', async () => {
    const r = await app.inject({ method: 'POST', url: '/webhooks/mpesa/stk?token=wrong', payload: {} });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/webhooks/mpesa/stk?token=test-callback-token',
      payload: {},
    });
    expect(ok.json()).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  it('applies a Daraja STK callback to the payment exactly once', async () => {
    const order = await call(app, buyerA, 'POST', '/v1/orders', { listingId, quantity: 2 });
    const pay = await call(app, buyerA, 'POST', `/v1/orders/${order.body.id}/pay`, {
      phoneNumber: '0712000111',
    });
    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    const body = {
      Body: {
        stkCallback: {
          MerchantRequestID: payment.merchantRequestId,
          CheckoutRequestID: payment.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: Math.ceil(payment.amount / 100) },
              { Name: 'MpesaReceiptNumber', Value: 'TST123' },
            ],
          },
        },
      },
    };
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST',
        url: '/webhooks/mpesa/stk?token=test-callback-token',
        payload: body,
      });
    }
    const after = await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('SUCCESS');
    expect(after.mpesaReceipt).toBe('TST123');
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).paymentStatus).toBe(
      'PAID',
    );
    expect(
      await app.prisma.auditLog.count({ where: { entityId: payment.id, action: 'payment.success' } }),
    ).toBe(1);
  });

  it('records failed M-Pesa payments without marking the order paid', async () => {
    const order = await call(app, buyerA, 'POST', '/v1/orders', { listingId, quantity: 1 });
    const pay = await call(app, buyerA, 'POST', `/v1/orders/${order.body.id}/pay`, {
      phoneNumber: '0712000999',
    });
    const { checkStkStatus } = await import('@farmgo/core');
    await checkStkStatus(app.prisma, pay.body.paymentId);
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } })).status).toBe(
      'FAILED',
    );
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } })).paymentStatus).toBe(
      'UNPAID',
    );
  });

  it('keeps admin tools admin-only', async () => {
    expect((await call(app, buyerA, 'GET', '/v1/admin/summary')).status).toBe(403);
    expect(
      (await call(app, farmer, 'POST', `/v1/admin/users/${farmer.userId}/role`, { role: 'admin' })).status,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/queues', headers: buyerA.headers })).statusCode,
    ).toBe(403);
  });

  it('suspends a banned user immediately', async () => {
    const admin = await emailUser(app, 'admin');
    const victim = await emailUser(app);
    expect((await call(app, victim, 'GET', '/v1/me')).status).toBe(200);
    const ban = await call(app, admin, 'POST', `/v1/admin/users/${victim.userId}/ban`, {
      reason: 'Fraudulent orders',
    });
    expect(ban.status).toBe(200);
    expect((await call(app, victim, 'GET', '/v1/me')).status).toBe(401);
    expect(await app.prisma.session.count({ where: { userId: victim.userId } })).toBe(0);
  });
});
