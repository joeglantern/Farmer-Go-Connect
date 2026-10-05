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

/** APP-023 (undo harvest ready before inspection) and APP-025 (reopen a closed listing). */
describe('harvest ready undo and reopening listings', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let qa: Session;
  let farmId: string;

  const listing = async (quantity = 50) =>
    (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'coriander'),
        quantity,
        pricePerUnit: 3000,
        availableFrom: days(0),
        availableTo: days(7),
      })
    ).body.id as string;

  const confirmedOrder = async (listingId: string, quantity = 5) => {
    const o = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity })).body;
    expect((await call(app, farmer, 'POST', `/v1/orders/${o.id}/confirm`)).status).toBe(200);
    return o.id as string;
  };

  const status = async (orderId: string) =>
    (await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Harvest Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Harvest Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Harvest Farmer',
      county: "Murang'a",
      farm: { name: 'Harvest Farm', county: "Murang'a" },
    });
    farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    qa = await emailUser(app, 'qa_officer');
  });
  afterAll(async () => closeApp(app));

  it('APP-023: undo before inspection sends the orders back to waiting for the harvest', async () => {
    const id = await listing();
    const orderId = await confirmedOrder(id);
    const ready = await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`);
    expect(ready.body.ordersReady).toBe(1);
    expect(await status(orderId)).toBe('READY_FOR_QA');

    const undo = await call(app, farmer, 'DELETE', `/v1/supply/${id}/harvest-ready`);
    expect(undo.status).toBe(200);
    expect(undo.body.harvestReady).toBe(false);
    expect(await status(orderId)).toBe('CONFIRMED');
    const history = await app.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.at(-1)).toMatchObject({ from: 'READY_FOR_QA', to: 'CONFIRMED', actorId: farmer.userId });
    const audited = await app.prisma.auditLog.count({
      where: { entity: 'Order', entityId: orderId, action: 'order.transition' },
    });
    expect(audited).toBeGreaterThanOrEqual(3);

    // Only the undo steps back: confirming a ready order is still refused.
    await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`);
    const reconfirm = await call(app, farmer, 'POST', `/v1/orders/${orderId}/confirm`);
    expect(reconfirm.body.error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(await status(orderId)).toBe('READY_FOR_QA');
    await call(app, farmer, 'DELETE', `/v1/supply/${id}/harvest-ready`);

    // Ready again works as before.
    expect((await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`)).body.ordersReady).toBe(1);
  });

  it('APP-023: once QA has recorded an inspection, the undo is refused', async () => {
    const id = await listing();
    const orderId = await confirmedOrder(id);
    await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const inspected = await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'A',
      passed: true,
      acceptedQty: 5,
      rejectedQty: 0,
    });
    expect(inspected.status).toBe(201);
    const undo = await call(app, farmer, 'DELETE', `/v1/supply/${id}/harvest-ready`);
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe('HARVEST_ALREADY_IN_QA');
    expect(await status(orderId)).not.toBe('CONFIRMED');
  });

  it('APP-025: a closed listing reopens with status OPEN and a future end date', async () => {
    const id = await listing(40);
    await confirmedOrder(id, 10);
    const closed = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'CANCELLED' });
    expect(closed.body.status).toBe('CANCELLED');
    // Other edits stay refused while it is closed.
    expect((await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { notes: 'x' })).body.error.code).toBe(
      'LISTING_CLOSED',
    );
    const reopened = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, {
      status: 'OPEN',
      availableTo: days(10),
    });
    expect(reopened.status).toBe(200);
    // Ten of forty are already sold, so it comes back partly matched.
    expect(reopened.body.status).toBe('PARTIALLY_MATCHED');

    // A window that has ended needs a new end date.
    await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'CANCELLED' });
    await app.prisma.supplyListing.update({
      where: { id },
      data: { availableFrom: new Date(days(-5)), availableTo: new Date(days(-1)) },
    });
    const ended = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN' });
    expect(ended.body.error.code).toBe('LISTING_WINDOW_ENDED');
  });

  it('APP-025: nothing left to sell, or a closed farm, keeps it closed', async () => {
    const id = await listing(5);
    await confirmedOrder(id, 5);
    await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'CANCELLED' });
    const empty = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN' });
    expect(empty.body.error.code).toBe('LISTING_NOTHING_LEFT');
    const more = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN', quantity: 12 });
    expect(more.status).toBe(200);

    await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'CANCELLED' });
    await app.prisma.farm.update({ where: { id: farmId }, data: { active: false } });
    const inactive = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN' });
    expect(inactive.body.error.code).toBe('FARM_INACTIVE');
    await app.prisma.farm.update({ where: { id: farmId }, data: { active: true } });
  });
});
