import { checkStkStatus, generateInvoices } from '@farmgo/core';
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

/** B28: admin detail screens and cross-organization money lists. */
describe('admin detail and money lists', () => {
  let app: FastifyInstance;
  let admin: Session;
  let buyer: Session;
  let orgId: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    buyer = await emailUser(app, undefined, 'Detail Buyer');
    orgId = (
      await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Detail Hotel',
        buyerCategory: 'HOTEL',
        county: 'Nairobi',
      })
    ).body.organization.id;
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Detail Farmer',
      county: 'Kiambu',
      farm: { name: 'Detail Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    const listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'carrots'),
        quantity: 100,
        pricePerUnit: 6000,
        availableFrom: days(0),
        availableTo: days(8),
      })
    ).body.id;
    orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 5 })).body.id;
    const pay = await call(app, buyer, 'POST', `/v1/orders/${orderId}/pay`, { phoneNumber: '0712345678' });
    paymentId = pay.body.paymentId;
    await checkStkStatus(app.prisma, paymentId);
    // A dispute to look at.
    for (const to of ['CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']) {
      await call(app, admin, 'POST', `/v1/orders/${orderId}/transition`, { to });
    }
    await call(app, buyer, 'POST', `/v1/orders/${orderId}/dispute`, {
      reason: 'QUALITY',
      description: 'Half the carrots were soft',
      photos: [`chat/${buyer.userId}/soft.jpg`],
    });
  });
  afterAll(async () => closeApp(app));

  it('shows one organization with members and activity', async () => {
    const r = await call(app, admin, 'GET', `/v1/admin/orgs/${orgId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      name: 'Detail Hotel',
      profile: { buyerCategory: 'HOTEL' },
      stats: { ordersTotal: 1, ordersOpen: 1, spendCents: 5 * 6000 + 30_000, invoicesDueCents: 0 },
    });
    expect(r.body.members[0].user).toMatchObject({ id: buyer.userId, role: 'buyer' });
    expect((await call(app, admin, 'GET', '/v1/admin/orgs/nope')).status).toBe(404);
    expect((await call(app, buyer, 'GET', `/v1/admin/orgs/${orgId}`)).status).toBe(403);
  });

  it('shows one dispute with its order and people', async () => {
    const list = await call(app, admin, 'GET', '/v1/admin/disputes?open=true');
    const id = list.body.items.find((d: any) => d.orderId === orderId).id;
    const r = await call(app, admin, 'GET', `/v1/admin/disputes/${id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      order: {
        id: orderId,
        status: 'DISPUTED',
        buyerOrg: { name: 'Detail Hotel' },
        farmer: { name: 'Detail Farmer' },
      },
      inputOrder: null,
      raisedBy: { id: buyer.userId },
      resolvedBy: null,
    });
    expect(r.body.photoUrls[0]).toMatch(/\/v1\/files\/chat\//);
  });

  it('lists payments across organizations with filters and totals', async () => {
    const r = await call(app, admin, 'GET', `/v1/admin/payments?orgId=${orgId}`);
    expect(r.status).toBe(200);
    expect(r.body.items.map((p: any) => p.id)).toEqual([paymentId]);
    expect(r.body.items[0]).toMatchObject({
      payer: { id: orgId, name: 'Detail Hotel', kind: 'org' },
      reference: expect.stringMatching(/^FG-/),
    });
    expect(r.body.items[0]).not.toHaveProperty('raw');
    expect(r.body.totals).toEqual({
      collectedCents: 5 * 6000 + 30_000,
      refundedCents: 0,
      pendingCents: 0,
      count: 1,
    });
    expect(
      (await call(app, admin, 'GET', `/v1/admin/payments?orgId=${orgId}&status=FAILED`)).body.items,
    ).toEqual([]);
    const future = await call(app, admin, 'GET', `/v1/admin/payments?orgId=${orgId}&from=${days(1)}`);
    expect(future.body.totals.count).toBe(0);
    expect((await call(app, admin, 'GET', '/v1/admin/payments?status=NOPE')).body.error.code).toBe(
      'INVALID_STATUS',
    );
    expect((await call(app, buyer, 'GET', '/v1/admin/payments')).status).toBe(403);
    // Buyers hold payment:read for their own payments; no admin money list may use it.
    expect((await call(app, buyer, 'GET', '/v1/admin/invoices')).status).toBe(403);
    expect((await call(app, buyer, 'GET', '/v1/admin/payouts')).status).toBe(403);
  });

  it('lists invoices across organizations with totals', async () => {
    const credit = await emailUser(app, undefined, 'Invoice Buyer');
    const creditOrg = (
      await call(app, credit, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Invoice Cafe',
        buyerCategory: 'RESTAURANT',
        county: 'Nairobi',
      })
    ).body.organization.id;
    await call(app, admin, 'POST', `/v1/admin/orgs/${creditOrg}/verify`, {
      verified: true,
      paymentTerms: 'NET_14',
      creditLimit: 10_000_000,
    });
    const listing = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const o = (await call(app, credit, 'POST', '/v1/orders', { listingId: listing.listingId, quantity: 2 }))
      .body;
    for (const to of ['CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']) {
      await call(app, admin, 'POST', `/v1/orders/${o.id}/transition`, { to });
    }
    await generateInvoices(app.prisma);
    const r = await call(app, admin, 'GET', `/v1/admin/invoices?orgId=${creditOrg}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({
      buyerOrg: { name: 'Invoice Cafe' },
      _count: { orders: 1 },
      status: 'ISSUED',
    });
    expect(r.body.totals).toEqual({
      totalCents: 2 * 6000 + 30_000,
      paidCents: 0,
      dueCents: 2 * 6000 + 30_000,
      count: 1,
    });
    expect(
      (await call(app, admin, 'GET', `/v1/admin/invoices?orgId=${creditOrg}&status=PAID`)).body.totals.count,
    ).toBe(0);
  });
});
