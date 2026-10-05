import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  closeApp,
  days,
  emailUser,
  makeApp,
  nextPhone,
  PASSWORD,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

/** B18: account deletion (anonymized, finances kept) and data export. */
describe('account deletion and export', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let phone: string;
  let listingId: string;
  let orderId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Export Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Export Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    phone = nextPhone();
    farmer = await phoneUser(app, phone);
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Leaving Farmer',
      county: 'Kiambu',
      dateOfBirth: '1990-01-01',
      farm: { name: 'Leaving Farm', county: 'Kiambu', lat: -1.1, lng: 36.8 },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 50,
        pricePerUnit: 2500,
        availableFrom: days(0),
        availableTo: days(6),
      })
    ).body.id;
    orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body.id;
    await call(app, buyer, 'POST', `/v1/orders/${orderId}/messages`, { body: 'Karibu' });
    await call(app, farmer, 'POST', `/v1/orders/${orderId}/messages`, { body: 'Asante' });
  });
  afterAll(async () => closeApp(app));

  it('exports everything held about the user, without secrets', async () => {
    const r = await call(app, farmer, 'GET', '/v1/me/export');
    expect(r.status).toBe(200);
    expect(r.raw.headers['content-disposition']).toMatch(/attachment; filename="farmgo-data-/);
    expect(r.body.user).toMatchObject({ name: 'Leaving Farmer', phoneNumber: phone });
    expect((r.body.farmerProfile.farms as any[])[0].listings).toHaveLength(1);
    expect(r.body.orders.map((o: any) => o.id)).toContain(orderId);
    expect(r.body.messages.map((m: any) => m.body)).toEqual(['Asante']);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/password|"raw"|token/i);
  });

  it('refuses deletion while an order is open, with a reason', async () => {
    const r = await call(app, farmer, 'POST', '/v1/me/delete-request');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'ACCOUNT_HAS_OPEN_ORDERS', details: { openOrders: 1 } });
    // A buyer who runs their business alone is blocked by its open orders too.
    expect((await call(app, buyer, 'POST', '/v1/me/delete-request')).body.error.code).toBe(
      'ACCOUNT_HAS_OPEN_ORDERS',
    );
  });

  it('refuses while money is still owed to the user', async () => {
    const owed = await phoneUser(app, nextPhone());
    await call(app, owed, 'POST', '/v1/onboarding/farmer', { name: 'Owed Farmer', county: 'Kiambu' });
    await app.prisma.payout.create({
      data: {
        orderId,
        farmerId: owed.userId,
        phoneNumber: '+254700000111',
        grossAmount: 100,
        commission: 8,
        amount: 92,
        status: 'FAILED',
        idempotencyKey: `owed-${owed.userId}`,
      },
    });
    const r = await call(app, owed, 'POST', '/v1/me/delete-request');
    expect(r.body.error.code).toBe('ACCOUNT_HAS_UNPAID_PAYOUTS');
    await app.prisma.payout.deleteMany({ where: { farmerId: owed.userId } });
  });

  it('deletes: personal data gone, sign-in blocked, orders kept and detached', async () => {
    await call(app, buyer, 'POST', `/v1/orders/${orderId}/cancel`, { reason: 'No longer needed' });
    const r = await call(app, farmer, 'POST', '/v1/me/delete-request');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const u = await app.prisma.user.findUniqueOrThrow({
      where: { id: farmer.userId },
      include: { farmerProfile: true },
    });
    expect(u).toMatchObject({ name: 'Deleted user', phoneNumber: null, banned: true, county: null });
    expect(u.email).toMatch(/@deleted\.farmgo\.local$/);
    expect(u.farmerProfile).toMatchObject({ mpesaNumber: '', dateOfBirth: null, nationalIdKey: null });
    const farm = await app.prisma.farm.findFirstOrThrow({ where: { farmerId: u.farmerProfile!.id } });
    expect(farm).toMatchObject({ active: false, lat: null, lng: null, name: 'Closed farm' });
    expect((await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe(
      'CANCELLED',
    );
    expect(await app.prisma.session.count({ where: { userId: farmer.userId } })).toBe(0);
    expect(await app.prisma.account.count({ where: { userId: farmer.userId } })).toBe(0);

    // The old token no longer works, and the order stays for the buyer's records.
    expect((await call(app, farmer, 'GET', '/v1/me')).status).toBe(401);
    const order = await call(app, buyer, 'GET', `/v1/orders/${orderId}`);
    expect(order.status).toBe(200);
    expect(order.body.farmer.name).toBe('Deleted user');

    // The phone number is free again: signing in with it starts a brand-new account.
    const fresh = await phoneUser(app, phone);
    expect(fresh.userId).not.toBe(farmer.userId);
  });

  it('deletes an email account: its password no longer signs in', async () => {
    const u = await emailUser(app, undefined, 'Short Stay');
    const email = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).email;
    expect((await call(app, u, 'POST', '/v1/me/delete-request')).status).toBe(200);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email, password: PASSWORD },
    });
    expect(signIn.statusCode).toBeGreaterThanOrEqual(400);
  });
});
