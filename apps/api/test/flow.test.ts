import { checkStkStatus, executePayout, matchDemand } from '@farmgo/core';
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

/**
 * The whole demand-led journey from the proposal, through the real API:
 * buyer demand → matching → both sides accept → harvest → QA → route → delivery →
 * M-Pesa payment → receipt confirmed → farmer payout.
 */
describe('demand-led supply flow', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let qa: Session;
  let admin: Session;
  let driver: Session;
  let farmId: string;
  let listingId: string;
  let demandId: string;
  let matchId: string;
  let orderId: string;
  let routeId: string;
  const s: Record<string, unknown> = {};

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Grace Hotel');
    farmer = await phoneUser(app, nextPhone());
    qa = await emailUser(app, 'qa_officer', 'Wanjiru QA');
    admin = await emailUser(app, 'admin', 'Admin');
    driver = await emailUser(app, 'driver', 'Otieno Driver');
    await app.prisma.user.update({ where: { id: driver.userId }, data: { county: 'Nairobi' } });
  });

  afterAll(async () => closeApp(app));

  it('a hotel onboards as a buyer', async () => {
    const res = await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Test Serena',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      lat: -1.2921,
      lng: 36.8219,
      address: 'Kenyatta Ave',
    });
    expect(res.status).toBe(201);
    const me = await call(app, buyer, 'GET', '/v1/me');
    expect(me.body.user.role).toBe('buyer');
    expect(me.body.permissions).toContain('demand:create');
    expect(me.body.organizations).toHaveLength(1);
  });

  it('a farmer signs in by phone and onboards with a farm', async () => {
    const me0 = await call(app, farmer, 'GET', '/v1/me');
    expect(me0.body.needsOnboarding).toBe(true);
    const res = await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Mary Wambui',
      county: 'Kiambu',
      gender: 'FEMALE',
      dateOfBirth: '1999-03-01',
      farm: { name: 'Wambui Greens', county: 'Kiambu', lat: -1.1714, lng: 36.8356, acreage: 2 },
    });
    expect(res.status).toBe(201);
    const farms = await call(app, farmer, 'GET', '/v1/farms');
    expect(farms.body).toHaveLength(1);
    farmId = farms.body[0].id;
  });

  it('the farmer lists an upcoming tomato harvest', async () => {
    const res = await call(app, farmer, 'POST', '/v1/supply', {
      farmId,
      produceId: await produceId(app, 'tomatoes'),
      quantity: 500,
      grade: 'A',
      pricePerUnit: 8000,
      availableFrom: days(1),
      availableTo: days(8),
    });
    expect(res.status).toBe(201);
    listingId = res.body.id;
    expect(res.body.quantityLeft).toBe(500);
  });

  it('the buyer posts demand and sees it on the anonymised board', async () => {
    const res = await call(app, buyer, 'POST', '/v1/demand', {
      produceId: await produceId(app, 'tomatoes'),
      quantity: 200,
      minGrade: 'A',
      maxPricePerUnit: 9000,
      neededBy: days(2),
    });
    expect(res.status).toBe(201);
    demandId = res.body.id;
    const board = await call(app, farmer, 'GET', '/v1/demand/board?county=Nairobi');
    expect(board.status).toBe(200);
    const row = board.body.find((r: { produceName: string }) => r.produceName === 'Tomatoes');
    expect(row.openQty).toBeGreaterThanOrEqual(200);
    expect(row).not.toHaveProperty('buyerOrgId');
  });

  it('the matching engine proposes the nearby farm', async () => {
    await drainOutbox(app);
    const matches = await matchDemand(app.prisma, demandId);
    expect(matches).toHaveLength(1);
    matchId = matches[0]!.id;
    expect(matches[0]!.distanceKm).toBeGreaterThan(5);
    expect(matches[0]!.distanceKm).toBeLessThan(40);
    const again = await matchDemand(app.prisma, demandId);
    expect(again).toHaveLength(0); // idempotent: quantity already proposed
    const forBuyer = await call(app, buyer, 'GET', '/v1/matches?status=PROPOSED');
    expect(forBuyer.body.items.map((m: { id: string }) => m.id)).toContain(matchId);
  });

  it('both sides accept and a confirmed order is created', async () => {
    const b = await call(app, buyer, 'POST', `/v1/matches/${matchId}/accept`);
    expect(b.status).toBe(200);
    expect(b.body.waitingFor).toBe('farmer');
    const f = await call(app, farmer, 'POST', `/v1/matches/${matchId}/accept`);
    expect(f.status).toBe(200);
    orderId = f.body.orderId;
    expect(orderId).toBeTruthy();
    const order = await call(app, buyer, 'GET', `/v1/orders/${orderId}`);
    expect(order.body.status).toBe('CONFIRMED');
    expect(order.body.subtotal).toBe(200 * 8000);
    expect(order.body.total).toBe(200 * 8000 + 30_000);
    const listing = await app.prisma.supplyListing.findUniqueOrThrow({ where: { id: listingId } });
    expect(Number(listing.quantityLeft)).toBe(300);
    expect(listing.status).toBe('PARTIALLY_MATCHED');
    const demand = await app.prisma.demandRequest.findUniqueOrThrow({ where: { id: demandId } });
    expect(demand.status).toBe('FILLED');
  });

  it('the buyer pays in advance by M-Pesa (held until delivery is accepted)', async () => {
    const res = await call(app, buyer, 'POST', `/v1/orders/${orderId}/pay`, { phoneNumber: '0712345678' });
    expect(res.status).toBe(202);
    await checkStkStatus(app.prisma, res.body.paymentId);
    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).toBe('CONFIRMED');
  });

  it('the farmer reports the harvest and QA inspects it', async () => {
    const ready = await call(app, farmer, 'POST', `/v1/supply/${listingId}/harvest-ready`);
    expect(ready.body.ordersReady).toBe(1);
    const tasks = await call(app, qa, 'GET', '/v1/qa/tasks');
    const task = tasks.body.find((o: { id: string }) => o.id === orderId);
    expect(task).toBeTruthy();
    const insp = await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: task.items[0].id,
      grade: 'A',
      passed: true,
      acceptedQty: 190,
      rejectedQty: 10,
      notes: '10kg split skins removed',
      location: 'FARM_GATE',
    });
    expect(insp.status).toBe(201);
    expect(insp.body.orderStatus).toBe('QA_PASSED');
    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.acceptedSubtotal).toBe(190 * 8000);
  });

  it('an admin builds a route and the driver collects and delivers with crates', async () => {
    const crates = await call(app, admin, 'POST', '/v1/crates', { count: 2 });
    s.crates = crates.body.qrCodes;
    const build = await call(app, admin, 'POST', '/v1/routes/build', { date: days(2) });
    expect(build.status).toBe(201);
    const route = build.body.routes.find((r: { id: string }) => r);
    routeId = route.id;
    if (!route.driverId)
      await call(app, admin, 'POST', `/v1/routes/${routeId}/assign`, { driverId: driver.userId });

    const mine = await call(app, driver, 'GET', '/v1/routes/today');
    const r =
      mine.body.find((x: { id: string }) => x.id === routeId) ??
      (await call(app, driver, 'GET', `/v1/routes/${routeId}`)).body;
    const [pickup, dropoff] = r.stops;
    expect(pickup.kind).toBe('PICKUP');
    expect(dropoff.kind).toBe('DROPOFF');

    expect((await call(app, driver, 'POST', `/v1/routes/${routeId}/start`)).status).toBe(200);
    const early = await call(app, driver, 'POST', `/v1/stops/${dropoff.id}/complete`, {
      podPhotoKey: `proof-of-delivery/${driver.userId}/a.jpg`,
    });
    expect(early.body.error.code).toBe('PICKUP_NOT_DONE');

    const p = await call(app, driver, 'POST', `/v1/stops/${pickup.id}/complete`, { crateQrCodes: s.crates });
    expect(p.status).toBe(200);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('IN_TRANSIT');

    const ping = await call(app, driver, 'POST', `/v1/routes/${routeId}/location`, {
      lat: -1.25,
      lng: 36.83,
    });
    expect(ping.body.accepted).toBe(true);
    const tracking = await call(app, buyer, 'GET', `/v1/orders/${orderId}/tracking`);
    expect(tracking.body.lastLocation.lat).toBe(-1.25);

    const noPod = await call(app, driver, 'POST', `/v1/stops/${dropoff.id}/complete`, {});
    expect(noPod.body.error.code).toBe('POD_REQUIRED');
    const d = await call(app, driver, 'POST', `/v1/stops/${dropoff.id}/complete`, {
      podPhotoKey: `proof-of-delivery/${driver.userId}/pod.jpg`,
      recipientName: 'Chef Peter',
      crateQrCodes: s.crates,
    });
    expect(d.status).toBe(200);

    const order = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('DELIVERED'); // paid, but held until the buyer accepts or the window closes
    expect(order.deliveredAt).toBeTruthy();
    const crate = await app.prisma.crate.findUniqueOrThrow({ where: { qrCode: (s.crates as string[])[0]! } });
    expect(crate.status).toBe('WITH_BUYER');
    const routeAfter = await app.prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(routeAfter.status).toBe('COMPLETED');
  });

  it('no payout is made while the buyer can still dispute', async () => {
    await drainOutbox(app);
    expect(await app.prisma.payout.findUnique({ where: { orderId } })).toBeNull();
  });

  it('the buyer confirms receipt and the farmer is paid for the accepted quantity', async () => {
    const res = await call(app, buyer, 'POST', `/v1/orders/${orderId}/confirm-receipt`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAID');
    await drainOutbox(app);
    const payout = await app.prisma.payout.findUniqueOrThrow({ where: { orderId } });
    expect(payout.grossAmount).toBe(190 * 8000);
    expect(payout.commission).toBe(Math.round(190 * 8000 * 0.08));
    await executePayout(app.prisma, orderId);
    const paid = await app.prisma.payout.findUniqueOrThrow({ where: { orderId } });
    expect(paid.status).toBe('SUCCESS');
    expect(paid.amount).toBe(190 * 8000 - Math.round(190 * 8000 * 0.08));

    const farmerPayouts = await call(app, farmer, 'GET', '/v1/payouts');
    expect(farmerPayouts.body.totalPaidCents).toBe(paid.amount);
  });

  it('both sides can review, and the order history is complete', async () => {
    expect(
      (
        await call(app, buyer, 'POST', `/v1/orders/${orderId}/review`, {
          rating: 5,
          comment: 'Excellent tomatoes',
        })
      ).status,
    ).toBe(201);
    expect((await call(app, farmer, 'POST', `/v1/orders/${orderId}/review`, { rating: 5 })).status).toBe(201);
    const order = await call(app, buyer, 'GET', `/v1/orders/${orderId}`);
    expect(order.body.events.map((e: { to: string }) => e.to)).toEqual([
      'PENDING',
      'CONFIRMED',
      'READY_FOR_QA',
      'QA_PASSED',
      'IN_TRANSIT',
      'DELIVERED',
      'PAID',
    ]);
    expect(order.body).not.toHaveProperty('payout'); // buyers never see the farmer's payout
  });

  it('notifications were produced for the farmer', async () => {
    const { handleEventNotification } = await import('@farmgo/core');
    await handleEventNotification(app.prisma, app.redis, 'payout.updated', {
      payoutId: (await app.prisma.payout.findUniqueOrThrow({ where: { orderId } })).id,
      status: 'SUCCESS',
    });
    const inbox = await call(app, farmer, 'GET', '/v1/notifications');
    expect(inbox.body.unread).toBeGreaterThan(0);
    expect(inbox.body.items[0].title).toBe('Umelipwa'); // farmers default to Kiswahili
  });

  it('the price index picks up the sale', async () => {
    const { rollupPriceIndex } = await import('@farmgo/core');
    await rollupPriceIndex(app.prisma);
    const prices = await call(app, buyer, 'GET', '/v1/prices/latest?county=Nairobi');
    const tomato = prices.body.find((p: { name: string }) => p.name === 'Tomatoes');
    expect(tomato.avgPrice).toBe(8000);
  });

  it('the impact report reflects the journey', async () => {
    const report = await call(app, admin, 'GET', '/v1/admin/reports/impact');
    expect(report.status).toBe(200);
    expect(report.body.trade.orders).toBeGreaterThanOrEqual(1);
    expect(report.body.trade.preHarvestMatchedKg).toBeGreaterThanOrEqual(200);
    expect(report.body.farmerIncome.paidOutCents).toBeGreaterThan(0);
    expect(report.body.farmers.womenPct).toBeGreaterThan(0);
  });
});
