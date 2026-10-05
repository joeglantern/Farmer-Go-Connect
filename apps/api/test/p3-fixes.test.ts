import { render } from '@farmgo/core';
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

/** Guards for the P3 bugs in docs/qa/BUGS.md: QA-025 and QA-027 to QA-031. */

const ussd = (app: FastifyInstance, phoneNumber: string, text: string, sessionId: string) =>
  app
    .inject({
      method: 'POST',
      url: '/webhooks/ussd?token=test-ussd-token',
      payload: { sessionId, phoneNumber, text },
    })
    .then((r) => r.body);

describe('QA P3 fixes', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let farmerPhone: string;
  let farmId: string;
  let listingId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'P3 Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'P3 Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    farmerPhone = nextPhone();
    farmer = await phoneUser(app, farmerPhone);
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'P3 Farmer',
      county: 'Turkana',
      farm: { name: 'P3 Farm', county: 'Turkana' },
    });
    farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'courgettes'),
        quantity: 100,
        pricePerUnit: 7000,
        availableFrom: days(0),
        availableTo: days(10),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('QA-025 demand and orders dated in the past are refused', async () => {
    const courgettes = await produceId(app, 'courgettes');
    const demand = await call(app, buyer, 'POST', '/v1/demand', {
      produceId: courgettes,
      quantity: 10,
      neededBy: days(-3),
    });
    expect(demand.status).toBe(400);
    expect(demand.body.error).toMatchObject({ code: 'DATE_IN_PAST', details: { field: 'neededBy' } });
    const order = await call(app, buyer, 'POST', '/v1/orders', {
      listingId,
      quantity: 1,
      deliveryDate: days(-3),
    });
    expect(order.status).toBe(400);
    expect(order.body.error.code).toBe('DATE_IN_PAST');

    const ok = await call(app, buyer, 'POST', '/v1/demand', {
      produceId: courgettes,
      quantity: 10,
      neededBy: days(2),
    });
    expect(ok.status).toBe(201);
    const moved = await call(app, buyer, 'PATCH', `/v1/demand/${ok.body.id}`, { neededBy: days(-1) });
    expect(moved.body.error.code).toBe('DATE_IN_PAST');
    await call(app, buyer, 'PATCH', `/v1/demand/${ok.body.id}`, { status: 'CANCELLED' });
  });

  it('QA-027 the missing-organization error fits the caller', async () => {
    const asFarmer = await call(app, farmer, 'GET', '/v1/orgs/current');
    expect(asFarmer.status).toBe(403);
    expect(asFarmer.body.error.code).toBe('NO_ORGANIZATION');
    expect(asFarmer.body.error.message).toMatch(/^Your account is not part of an organization/);
    expect(asFarmer.body.error.message).not.toMatch(/onboarding/);

    const admin = await emailUser(app, 'admin');
    expect((await call(app, admin, 'GET', '/v1/orgs/current')).body.error.message).toMatch(/X-Org-Id/);

    const fresh = await emailUser(app, undefined, 'Not Yet Set Up');
    const r = await call(app, fresh, 'GET', '/v1/orgs/current');
    expect(r.body.error).toMatchObject({
      code: 'NO_ORGANIZATION',
      message: 'Set up your business or household profile first',
      details: { onboarding: '/v1/onboarding/buyer' },
    });
  });

  it('QA-028 a payment without a receipt has no empty receipt clause', () => {
    const none = render('payment_success', 'en', { amount: '850', reference: 'FG-26-001008', receipt: '' });
    expect(none.body).toBe('We received KES 850 for FG-26-001008.');
    const sw = render('payment_success', 'sw', { amount: '850', reference: 'FG-26-001008', receipt: '' });
    expect(sw.body).toBe('Tumepokea KES 850 kwa FG-26-001008.');
    const withReceipt = render('payment_success', 'en', {
      amount: '850',
      reference: 'FG-26-001008',
      receipt: 'QAB12',
    });
    expect(withReceipt.body).toBe('We received KES 850 for FG-26-001008. Receipt QAB12.');
  });

  it('QA-029 USSD selling explains an out-of-range quantity or price', async () => {
    expect(await ussd(app, farmerPhone, '1*1*99999999999', 'p3-qty')).toMatch(
      /^END .*(Kiasi si sahihi|Invalid quantity)/,
    );
    expect(await ussd(app, farmerPhone, '1*1*50*1*0.5', 'p3-price')).toMatch(
      /^END .*(Bei si sahihi|Invalid price)/,
    );
    expect(await ussd(app, farmerPhone, '1*1*50*1*60*1', 'p3-ok')).toMatch(/^END .*(yameorodheshwa|Listed)/);
  });

  it('QA-030 USSD order actions say where the order already stands', async () => {
    const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body;
    expect((await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`)).status).toBe(200);
    expect((await call(app, farmer, 'POST', `/v1/orders/${order.id}/ready`)).status).toBe(200);
    // The order is the only open one, so it is item 1 in "Oda zangu".
    expect(await ussd(app, farmerPhone, '3*1*1', 'p3-confirm')).toMatch(
      /^END .*(tayari imethibitishwa|already confirmed)/,
    );
    expect(await ussd(app, farmerPhone, '3*1*2', 'p3-ready')).toMatch(
      /^END .*(tayari iko tayari|already marked ready)/,
    );
  });

  it('QA-031 a draft listing is hidden from other users by id', async () => {
    const draft = await call(app, farmer, 'POST', '/v1/supply', {
      farmId,
      produceId: await produceId(app, 'courgettes'),
      quantity: 20,
      pricePerUnit: 7000,
      availableFrom: days(0),
      availableTo: days(5),
      status: 'DRAFT',
    });
    expect(draft.status).toBe(201);
    expect((await call(app, buyer, 'GET', `/v1/supply/${draft.body.id}`)).status).toBe(404);
    const own = await call(app, farmer, 'GET', `/v1/supply/${draft.body.id}`);
    expect(own.status).toBe(200);
    expect(own.body.status).toBe('DRAFT');
  });

  it('QA-032 validation errors carry codes the app can translate', async () => {
    const r = await call(app, buyer, 'POST', '/v1/demand', { quantity: -1 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    for (const issue of r.body.error.details.issues) {
      expect(issue).toMatchObject({ path: expect.any(String), code: expect.any(String) });
    }
  });
});
