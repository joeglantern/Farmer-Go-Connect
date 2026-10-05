import { checkStkStatus } from '@farmgo/core';
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

/** B04: individuals and families buy for home, prepaid by M-Pesa. */
describe('household buyers', () => {
  let app: FastifyInstance;
  let admin: Session;
  let listingId: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Home Farmer',
      county: 'Kiambu',
      farm: { name: 'Home Farm', county: 'Kiambu', lat: -1.1, lng: 36.8 },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 100,
        pricePerUnit: 2500,
        availableFrom: days(0),
        availableTo: days(7),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('signs up by phone, orders and pays by M-Pesa as a household', async () => {
    const phone = nextPhone();
    const home = await phoneUser(app, phone);
    const r = await call(app, home, 'POST', '/v1/onboarding/household', {
      name: 'Amina Otieno',
      county: 'Nairobi',
      address: 'Kilimani, Argwings Kodhek Rd',
    });
    expect(r.status).toBe(201);
    expect(r.body.organization.name).toBe('Amina Otieno');
    expect(r.body.profile).toMatchObject({
      type: 'BUYER',
      buyerCategory: 'HOUSEHOLD',
      paymentTerms: 'PREPAID',
      kraPin: null,
      phone,
    });
    const me = await call(app, home, 'GET', '/v1/me');
    expect(me.body.user).toMatchObject({ role: 'buyer', name: 'Amina Otieno' });

    // A retry returns the same household, not a second one.
    const again = await call(app, home, 'POST', '/v1/onboarding/household', {
      name: 'Amina Otieno',
      county: 'Nairobi',
    });
    expect(again.status).toBe(200);
    expect(again.body.organization.id).toBe(r.body.organization.id);

    const order = await call(app, home, 'POST', '/v1/orders', { listingId, quantity: 3 });
    expect(order.status).toBe(201);
    expect(order.body.deliveryAddress).toBe('Kilimani, Argwings Kodhek Rd');
    const pay = await call(app, home, 'POST', `/v1/orders/${order.body.id}/pay`, {});
    expect(pay.status).toBe(202); // charges the account's own phone by default
    await checkStkStatus(app.prisma, pay.body.paymentId);
    const paid = await app.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    expect(paid.paymentStatus).toBe('PAID');
  });

  it('never puts a household on credit terms', async () => {
    const home = await emailUser(app, undefined, 'Credit Seeker');
    const org = (
      await call(app, home, 'POST', '/v1/onboarding/household', { name: 'Credit Seeker', county: 'Nairobi' })
    ).body.organization.id;
    const r = await call(app, admin, 'POST', `/v1/admin/orgs/${org}/verify`, {
      verified: true,
      paymentTerms: 'NET_14',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('HOUSEHOLD_PREPAID_ONLY');
    const ok = await call(app, admin, 'POST', `/v1/admin/orgs/${org}/verify`, { verified: true });
    expect(ok.body).toMatchObject({ verified: true, paymentTerms: 'PREPAID' });
  });

  it('refuses credit terms on a supplier organization (QA-026)', async () => {
    const s = await emailUser(app, undefined, 'Supplier Terms');
    const org = (
      await call(app, s, 'POST', '/v1/onboarding/supplier', {
        businessName: 'Terms Compost',
        county: 'Kiambu',
      })
    ).body.organization.id;
    const r = await call(app, admin, 'POST', `/v1/admin/orgs/${org}/verify`, {
      verified: true,
      paymentTerms: 'NET_30',
    });
    expect(r.body.error.code).toBe('CREDIT_TERMS_NOT_APPLICABLE');
  });

  it('keeps household and business buying apart', async () => {
    const hotel = await emailUser(app, undefined, 'Hotel Buyer');
    await call(app, hotel, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Business Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    const asHome = await call(app, hotel, 'POST', '/v1/onboarding/household', {
      name: 'Hotel Buyer',
      county: 'Nairobi',
    });
    expect(asHome.status).toBe(409);
    expect(asHome.body.error.code).toBe('ALREADY_BUSINESS_BUYER');

    const home = await emailUser(app, undefined, 'Home Buyer');
    await call(app, home, 'POST', '/v1/onboarding/household', { name: 'Home Buyer', county: 'Nairobi' });
    const asBusiness = await call(app, home, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Home Buyer Cafe',
      buyerCategory: 'RESTAURANT',
      county: 'Nairobi',
    });
    expect(asBusiness.status).toBe(409);
    expect(asBusiness.body.error.code).toBe('ALREADY_HOUSEHOLD_BUYER');
    expect(await app.prisma.member.count({ where: { userId: home.userId } })).toBe(1);
  });

  it('keeps households to one role', async () => {
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', { name: 'Two Hats', county: 'Kiambu' });
    const r = await call(app, farmer, 'POST', '/v1/onboarding/household', {
      name: 'Two Hats',
      county: 'Kiambu',
    });
    expect(r.status).toBe(409);
  });
});
