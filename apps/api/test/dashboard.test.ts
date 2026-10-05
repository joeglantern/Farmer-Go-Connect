import { matchDemand } from '@farmgo/core';
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

/** B10: one call per role home screen, numbers checked against data made here. */
describe('role dashboards', () => {
  let app: FastifyInstance;
  let farmer: Session;
  let buyer: Session;
  let listingId: string;
  let farmId: string;

  beforeAll(async () => {
    app = await makeApp();
    farmer = await phoneUser(app, nextPhone());
    buyer = await emailUser(app, undefined, 'Dash Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Dash Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      lat: -1.29,
      lng: 36.82,
    });
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Dash Farmer',
      county: 'Kiambu',
      farm: { name: 'Dash Farm', county: 'Kiambu', lat: -1.17, lng: 36.83 },
    });
    farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'garlic'),
        quantity: 500,
        pricePerUnit: 20_000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('farmer: listings, orders, sales and actions waiting', async () => {
    const a = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body;
    const b = (
      await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 3, deliveryDate: days(1) })
    ).body;
    await call(app, farmer, 'POST', `/v1/orders/${b.id}/confirm`);
    const demand = (
      await call(app, buyer, 'POST', '/v1/demand', {
        produceId: await produceId(app, 'garlic'),
        quantity: 20,
        neededBy: days(3),
      })
    ).body;
    await drainOutbox(app);
    expect((await matchDemand(app.prisma, demand.id)).length).toBe(1);
    // A completed payout this month.
    await app.prisma.payout.create({
      data: {
        orderId: a.id,
        farmerId: farmer.userId,
        phoneNumber: '+254700000001',
        grossAmount: 40_000,
        commission: 3_200,
        amount: 36_800,
        status: 'SUCCESS',
        idempotencyKey: `dash-${a.id}`,
      },
    });

    const r = await call(app, farmer, 'GET', '/v1/dashboard/farmer');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      activeListings: 1,
      ordersReceived: { allTime: 2, thisMonth: 2 },
      sales: { allTimeCents: 36_800, thisMonthCents: 36_800 },
      actions: {
        matchesWaiting: 1,
        ordersToConfirm: 1,
        harvestsDue48h: 1,
        payoutsPending: 0,
        // The confirmed order (3 x 20,000) minus 8% commission is on the way.
        payoutsPendingCents: 60_000 - 4_800,
      },
    });
    expect((await call(app, buyer, 'GET', '/v1/dashboard/farmer')).status).toBe(403);
  });

  it('buyer: orders, month spend, active orders, requirements, matches', async () => {
    const r = await call(app, buyer, 'GET', '/v1/dashboard/buyer');
    expect(r.status).toBe(200);
    expect(r.body.totalOrders).toBe(2);
    expect(r.body.thisMonthSpend).toBe(2 * 20_000 + 3 * 20_000 + 2 * 30_000);
    expect(r.body.activeOrders).toHaveLength(2);
    expect(r.body.activeOrders[0]).toMatchObject({ farmerName: 'Dash Farmer' });
    expect(r.body.matchesWaiting).toBe(1);
    expect(r.body.upcomingRequirements[0]).toMatchObject({ produceName: 'Garlic', quantity: 20 });
    expect(r.body.invoicesDue).toEqual({ count: 0, amountCents: 0 });
  });

  it('supplier, agent, driver and QA', async () => {
    const supplier = await emailUser(app, undefined, 'Dash Supplier');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Dash Compost',
      county: 'Kiambu',
    });
    const product = (
      await call(app, supplier, 'POST', '/v1/inputs', {
        name: 'Dash compost',
        category: 'COMPOST',
        unit: 'BAG',
        pricePerUnit: 50_000,
        stock: 3,
        county: 'Kiambu',
      })
    ).body;
    await call(app, farmer, 'POST', `/v1/inputs/${product.id}/order`, { quantity: 1 });
    const s = await call(app, supplier, 'GET', '/v1/dashboard/supplier');
    expect(s.body).toMatchObject({
      activeProducts: 1,
      lowStockProducts: 1,
      lowStockThreshold: 5,
      ordersToHandle: 1,
      ordersThisMonth: 1,
      salesThisMonthCents: 50_000,
      paidOutAllTimeCents: 0,
    });

    const agent = await emailUser(app, 'agent', 'Dash Agent');
    const created = await call(app, agent, 'POST', '/v1/agent/farmers', {
      phoneNumber: nextPhone(),
      name: 'Agent Farmer',
      county: 'Kiambu',
      farm: { name: 'Agent Farm', county: 'Kiambu' },
    });
    const agentFarm = await app.prisma.farm.findFirstOrThrow({
      where: { farmerId: created.body.profile.id },
    });
    await call(app, agent, 'POST', '/v1/supply', {
      farmId: agentFarm.id,
      produceId: await produceId(app, 'kale'),
      quantity: 50,
      pricePerUnit: 2_500,
      availableFrom: days(0),
      availableTo: days(4),
    });
    const ag = await call(app, agent, 'GET', '/v1/dashboard/agent');
    expect(ag.body).toMatchObject({
      farmersOnboarded: { allTime: 1, thisMonth: 1 },
      listingsCreated: { allTime: 1, thisMonth: 1 },
      pendingKyc: 1,
    });

    const driver = await emailUser(app, 'driver', 'Dash Driver');
    const order = await app.prisma.order.findFirstOrThrow({ where: { farmerId: farmer.userId } });
    const route = await app.prisma.route.create({
      data: {
        code: `RT-DASH-${Date.now()}`,
        driverId: driver.userId,
        date: new Date(new Date().toISOString().slice(0, 10)),
        county: 'Nairobi',
        stops: {
          create: [
            { orderId: order.id, kind: 'PICKUP', sequence: 1, address: 'Dash Farm', status: 'COMPLETED' },
            { orderId: order.id, kind: 'DROPOFF', sequence: 2, address: 'Dash Hotel' },
          ],
        },
      },
    });
    const d = await call(app, driver, 'GET', '/v1/dashboard/driver');
    const mine = d.body.routes.find((x: any) => x.id === route.id);
    expect(mine).toMatchObject({
      stopsTotal: 2,
      stopsDone: 1,
      nextStop: { kind: 'DROPOFF', address: 'Dash Hotel' },
    });

    const confirmed = await app.prisma.order.findFirstOrThrow({
      where: { farmerId: farmer.userId, status: 'CONFIRMED' },
    });
    await call(app, farmer, 'POST', `/v1/orders/${confirmed.id}/ready`);
    const qa = await emailUser(app, 'qa_officer', 'Dash QA');
    const q = await call(app, qa, 'GET', '/v1/dashboard/qa');
    expect(q.status).toBe(200);
    expect(q.body.tasksByCounty.find((c: any) => c.county === 'Kiambu').tasks).toBeGreaterThanOrEqual(1);
  });
});
