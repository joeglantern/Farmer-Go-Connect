import { generateInvoices } from '@farmgo/core';
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

/** APP-020: manual payments by order code or invoice number. APP-036: orders ?scope=active|past. */
describe('manual payments by reference, and order scopes', () => {
  let app: FastifyInstance;
  let admin: Session;
  let buyer: Session;
  let farmer: Session;
  let listingId: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    buyer = await emailUser(app, undefined, 'Reference Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Reference Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Reference Farmer',
      county: 'Machakos',
      farm: { name: 'Reference Farm', county: 'Machakos' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'mangoes'),
        quantity: 200,
        pricePerUnit: 4000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('APP-020: records a bank transfer against an order code', async () => {
    const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body;
    const r = await call(app, admin, 'POST', '/v1/admin/payments/manual', {
      orderId: ` ${order.code.toLowerCase()} `,
      amount: 2 * 4000,
      method: 'BANK_TRANSFER',
      reference: `BT-${order.code}`,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ orderId: order.id, status: 'SUCCESS', amount: 8000 });

    const missing = await call(app, admin, 'POST', '/v1/admin/payments/manual', {
      orderId: 'FG-99-999999',
      amount: 100,
      method: 'CASH',
      reference: 'nothing',
    });
    expect(missing.status).toBe(404);
  });

  it('APP-020: records a payment against an invoice number', async () => {
    const credit = await emailUser(app, undefined, 'Reference Cafe');
    const orgId = (
      await call(app, credit, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Reference Cafe',
        buyerCategory: 'RESTAURANT',
        county: 'Nairobi',
      })
    ).body.organization.id;
    await call(app, admin, 'POST', `/v1/admin/orgs/${orgId}/verify`, {
      verified: true,
      paymentTerms: 'NET_14',
      creditLimit: 10_000_000,
    });
    const o = (await call(app, credit, 'POST', '/v1/orders', { listingId, quantity: 1 })).body;
    for (const to of ['CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']) {
      await call(app, admin, 'POST', `/v1/orders/${o.id}/transition`, { to });
    }
    await generateInvoices(app.prisma);
    const inv = await app.prisma.invoice.findFirstOrThrow({ where: { buyerOrgId: orgId } });
    const r = await call(app, admin, 'POST', '/v1/admin/payments/manual', {
      invoiceId: inv.number,
      amount: 1000,
      method: 'CASH',
      reference: `CASH-${inv.number}`,
    });
    expect(r.status).toBe(201);
    expect(r.body.invoiceId).toBe(inv.id);
    const missing = await call(app, admin, 'POST', '/v1/admin/payments/manual', {
      invoiceId: 'INV-99-99999',
      amount: 100,
      method: 'CASH',
      reference: 'nothing here',
    });
    expect(missing.status).toBe(404);
  });

  it('APP-036: scope splits active from past orders', async () => {
    const shopper = await emailUser(app, undefined, 'Scope Buyer');
    await call(app, shopper, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Scope Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    const open = (await call(app, shopper, 'POST', '/v1/orders', { listingId, quantity: 1 })).body;
    const done = (await call(app, shopper, 'POST', '/v1/orders', { listingId, quantity: 1 })).body;
    await call(app, shopper, 'POST', `/v1/orders/${done.id}/cancel`, { reason: 'Changed my mind' });

    const ids = async (q: string) =>
      (await call(app, shopper, 'GET', `/v1/orders${q}`)).body.items.map((o: any) => o.id);
    expect(await ids('?scope=active')).toEqual([open.id]);
    expect(await ids('?scope=past')).toEqual([done.id]);
    expect((await ids('')).sort()).toEqual([open.id, done.id].sort());
    expect(await ids('?scope=past&status=PENDING')).toEqual([]);
    expect((await call(app, shopper, 'GET', '/v1/orders?scope=soon')).status).toBe(400);
  });
});
