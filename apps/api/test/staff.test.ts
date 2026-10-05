import { rollupPriceIndex } from '@farmgo/core';
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

/** B19 to B27: staff history, single reads, supplier scoping, farmer lifecycle and small lookups. */
describe('staff and lifecycle endpoints', () => {
  let app: FastifyInstance;
  let admin: Session;
  let buyer: Session;
  let farmer: Session;
  let farmId: string;
  let listingId: string;
  let orderId: string;
  const COUNTY = 'Kwale';

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    buyer = await emailUser(app, undefined, 'Staff Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Staff Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      phone: '0733999888',
    });
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Staff Farmer',
      county: COUNTY,
      farm: { name: 'Kwale Farm', county: COUNTY, lat: -4.17, lng: 39.45 },
    });
    farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'watermelon'),
        quantity: 100,
        pricePerUnit: 5000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
    orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 10 })).body.id;
    await call(app, farmer, 'POST', `/v1/orders/${orderId}/confirm`);
  });
  afterAll(async () => closeApp(app));

  it('B23: QA tasks for every county with county=all', async () => {
    await call(app, farmer, 'POST', `/v1/orders/${orderId}/ready`);
    const qa = await emailUser(app, 'qa_officer', 'Coast QA');
    await app.prisma.user.update({ where: { id: qa.userId }, data: { county: 'Nairobi' } });
    const own = await call(app, qa, 'GET', '/v1/qa/tasks');
    expect(own.body.some((o: any) => o.id === orderId)).toBe(false); // their own county is Nairobi
    const all = await call(app, qa, 'GET', '/v1/qa/tasks?county=all');
    expect(all.body.some((o: any) => o.id === orderId)).toBe(true);
  });

  it('B19: an officer’s inspection history and a driver’s routes', async () => {
    const qa = await emailUser(app, 'qa_officer', 'History QA');
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'A',
      passed: true,
      acceptedQty: 10,
    });
    const mine = await call(app, qa, 'GET', '/v1/qa/inspections');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].orderItem).toMatchObject({
      order: { id: orderId, buyerOrg: { name: 'Staff Hotel' } },
      listing: { produce: { name: 'Watermelon' }, farm: { county: COUNTY } },
    });
    expect((await call(app, qa, 'GET', '/v1/qa/inspections?passed=false')).body.items).toHaveLength(0);
    const other = await emailUser(app, 'qa_officer');
    expect((await call(app, other, 'GET', '/v1/qa/inspections')).body.items).toHaveLength(0);

    const driver = await emailUser(app, 'driver', 'History Driver');
    const route = await app.prisma.route.create({
      data: {
        code: `RT-HIST-${Date.now()}`,
        driverId: driver.userId,
        date: new Date(new Date().toISOString().slice(0, 10)),
        county: 'Nairobi',
        status: 'COMPLETED',
        completedAt: new Date(),
        // Linked like real route building does, so no other test sees an unrouted order with stops.
        orders: { connect: { id: orderId } },
        stops: {
          create: [
            { orderId, kind: 'PICKUP', sequence: 1, status: 'COMPLETED' },
            { orderId, kind: 'DROPOFF', sequence: 2, status: 'FAILED' },
          ],
        },
      },
    });
    const routes = await call(app, driver, 'GET', '/v1/driver/routes?status=COMPLETED');
    expect(routes.body.items[0]).toMatchObject({ id: route.id, stopsTotal: 2, stopsDone: 2 });
    expect(routes.body.items[0].completedAt).toBeTruthy();
  });

  it('B20 + B22: one stop, with Kiswahili names and the buyer phone on drop-offs only', async () => {
    const driver = await emailUser(app, 'driver', 'Stop Driver');
    // Stops are unique per order and kind, so this test uses an order of its own.
    const stopOrder = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body.id;
    const route = await app.prisma.route.create({
      data: {
        code: `RT-STOP-${Date.now()}`,
        driverId: driver.userId,
        date: new Date(new Date().toISOString().slice(0, 10)),
        county: 'Nairobi',
        orders: { connect: { id: stopOrder } },
        stops: {
          create: [
            { orderId: stopOrder, kind: 'PICKUP', sequence: 1 },
            { orderId: stopOrder, kind: 'DROPOFF', sequence: 2 },
          ],
        },
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    const [pickup, dropoff] = route.stops;
    const d = await call(app, driver, 'GET', `/v1/stops/${dropoff!.id}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({
      route: { id: route.id },
      order: { id: stopOrder, buyerOrg: { phone: '+254733999888' } },
    });
    expect(d.body.order.items[0].listing.produce.nameSw).toBe('Tikiti maji');
    expect((await call(app, driver, 'GET', `/v1/stops/${pickup!.id}`)).body.order.buyerOrg.phone).toBeNull();
    const stranger = await emailUser(app, 'driver');
    expect((await call(app, stranger, 'GET', `/v1/stops/${dropoff!.id}`)).status).toBe(404);

    const full = await call(app, driver, 'GET', `/v1/routes/${route.id}`);
    expect(full.body.stops.map((s: any) => s.order.buyerOrg.phone)).toEqual([null, '+254733999888']);
  });

  it('B20 + B24: agents read one farmer and list their farms', async () => {
    const agent = await emailUser(app, 'agent', 'Coast Agent');
    const created = await call(app, agent, 'POST', '/v1/agent/farmers', {
      phoneNumber: nextPhone(),
      name: 'Agent Farmer',
      county: COUNTY,
      farm: { name: 'Agent Farm', county: COUNTY },
    });
    const id = created.body.profile.id;
    const one = await call(app, agent, 'GET', `/v1/agent/farmers/${id}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      kycStatus: 'PENDING',
      performance: { ordersTotal: 0, activeListings: 0 },
    });
    expect(one.body.farms[0].name).toBe('Agent Farm');
    const farms = await call(app, agent, 'GET', `/v1/farms?farmerId=${id}`);
    expect(farms.body.map((f: any) => f.name)).toEqual(['Agent Farm']);
    const other = await emailUser(app, 'agent');
    expect((await call(app, other, 'GET', `/v1/agent/farmers/${id}`)).status).toBe(404);
    expect((await call(app, other, 'GET', `/v1/farms?farmerId=${id}`)).status).toBe(404);
  });

  it('B24: a farmer sees the demand their listings could fill', async () => {
    await call(app, buyer, 'POST', '/v1/demand', {
      produceId: await produceId(app, 'watermelon'),
      quantity: 30,
      neededBy: days(3),
    });
    const board = await call(app, farmer, 'GET', '/v1/demand/board?mine=true');
    expect(board.status).toBe(200);
    const row = board.body.find((r: any) => r.produceName === 'Watermelon');
    expect(row.listingIds).toContain(listingId);
    expect(board.body.every((r: any) => r.listingIds.length > 0)).toBe(true);
  });

  it('B25: farm pin clearing, delete or archive, listing reactivation, harvest-ready undo', async () => {
    const cleared = await call(app, farmer, 'PATCH', `/v1/farms/${farmId}`, { lat: null, lng: null });
    expect(cleared.body).toMatchObject({ lat: null, lng: null });

    const spare = await call(app, farmer, 'POST', '/v1/farms', { name: 'Spare Plot', county: COUNTY });
    expect((await call(app, farmer, 'DELETE', `/v1/farms/${spare.body.id}`)).body).toEqual({
      ok: true,
      archived: false,
    });
    const busy = await call(app, farmer, 'DELETE', `/v1/farms/${farmId}`);
    expect(busy.body.error.code).toBe('FARM_IN_USE');

    const second = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 10,
        pricePerUnit: 2500,
        availableFrom: days(0),
        availableTo: days(2),
      })
    ).body;
    await app.prisma.supplyListing.update({ where: { id: second.id }, data: { status: 'EXPIRED' } });
    const stillClosed = await call(app, farmer, 'PATCH', `/v1/supply/${second.id}`, { notes: 'x' });
    expect(stillClosed.body.error.code).toBe('LISTING_CLOSED');
    const back = await call(app, farmer, 'PATCH', `/v1/supply/${second.id}`, {
      availableFrom: days(1),
      availableTo: days(6),
    });
    expect(back.body.status).toBe('OPEN');

    await call(app, farmer, 'POST', `/v1/supply/${second.id}/harvest-ready`);
    const undo = await call(app, farmer, 'DELETE', `/v1/supply/${second.id}/harvest-ready`);
    expect(undo.body.harvestReady).toBe(false);
    // The watermelon listing's order is already with QA, so its harvest cannot be undone.
    expect((await call(app, farmer, 'DELETE', `/v1/supply/${listingId}/harvest-ready`)).body.error.code).toBe(
      'HARVEST_ALREADY_IN_QA',
    );
  });

  it('B21 + B26: supplier catalog, order scoping, low stock and earnings', async () => {
    const supplier = await emailUser(app, undefined, 'Scoped Supplier');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Scoped Compost',
      county: COUNTY,
    });
    const make = (name: string, stock: number) =>
      call(app, supplier, 'POST', '/v1/inputs', {
        name,
        category: 'COMPOST',
        unit: 'BAG',
        pricePerUnit: 40_000,
        stock,
        county: COUNTY,
      });
    const a = (await make('Scoped A', 50)).body;
    const b = (await make('Scoped B', 50)).body;
    await call(app, supplier, 'PATCH', `/v1/inputs/${b.id}`, { active: false });
    const mine = await call(app, supplier, 'GET', '/v1/inputs?mine=true');
    expect(mine.body.items.map((p: any) => p.name).sort()).toEqual(['Scoped A', 'Scoped B']);
    expect(
      (await call(app, supplier, 'GET', '/v1/inputs?q=Scoped')).body.items.map((p: any) => p.name),
    ).toEqual(['Scoped A']);

    // The supplier also buys from another supplier.
    const other = await emailUser(app, undefined, 'Other Supplier');
    await call(app, other, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Other Seedlings',
      county: COUNTY,
    });
    const seedling = (
      await call(app, other, 'POST', '/v1/inputs', {
        name: 'Seedlings',
        category: 'SEEDLINGS',
        unit: 'PIECE',
        pricePerUnit: 5_000,
        stock: 100,
        county: COUNTY,
      })
    ).body;
    await call(app, supplier, 'POST', `/v1/inputs/${seedling.id}/order`, { quantity: 2 });
    await call(app, farmer, 'POST', `/v1/inputs/${a.id}/order`, { quantity: 1 });
    const selling = await call(app, supplier, 'GET', '/v1/input-orders?as=seller');
    expect(selling.body.items.map((o: any) => o.product.name)).toEqual(['Scoped A']);
    const buying = await call(app, supplier, 'GET', '/v1/input-orders?as=buyer');
    expect(buying.body.items.map((o: any) => o.product.name)).toEqual(['Seedlings']);

    await call(app, admin, 'PUT', '/v1/admin/settings/lowStockThreshold', { value: 60 });
    expect((await call(app, supplier, 'GET', '/v1/dashboard/supplier')).body.lowStockProducts).toBe(1);
    await call(app, admin, 'PUT', '/v1/admin/settings/lowStockThreshold', { value: 5 });

    const earnings = await call(app, supplier, 'GET', '/v1/payouts?as=supplier');
    expect(earnings.status).toBe(200);
    expect(earnings.body).toMatchObject({ totalPaidCents: 0, paidThisMonthCents: 0, pendingCents: 0 });
    expect(typeof earnings.body.heldCents).toBe('number');
    const farmerEarnings = await call(app, farmer, 'GET', '/v1/payouts');
    expect(farmerEarnings.body).toHaveProperty('heldCents');
  });

  it('B27: the latest price for one produce', async () => {
    await rollupPriceIndex(app.prisma);
    const watermelon = await produceId(app, 'watermelon');
    const r = await call(app, buyer, 'GET', `/v1/prices/latest?produceId=${watermelon}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((p: any) => p.produceId === watermelon)).toBe(true);
  });
});
