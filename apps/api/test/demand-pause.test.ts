import { demandBoard, matchDemand } from '@farmgo/core';
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

const COUNTY = 'Laikipia'; // no other test uses it

/** B29: buyers pause and resume requirements; paused demand is out of matching and the board. */
describe('pausing demand', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let cabbage: string;

  beforeAll(async () => {
    app = await makeApp();
    cabbage = await produceId(app, 'cabbage');
    buyer = await emailUser(app, undefined, 'Pause Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Nanyuki Lodge',
      buyerCategory: 'HOTEL',
      county: COUNTY,
      lat: 0.01,
      lng: 37.07,
    });
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Pause Farmer',
      county: COUNTY,
      farm: { name: 'Nanyuki Farm', county: COUNTY, lat: 0.02, lng: 37.08 },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    await call(app, farmer, 'POST', '/v1/supply', {
      farmId,
      produceId: cabbage,
      quantity: 1000,
      pricePerUnit: 4000,
      availableFrom: days(0),
      availableTo: days(30),
    });
  });
  afterAll(async () => closeApp(app));

  const onBoard = async () =>
    (await demandBoard(app.prisma, { county: COUNTY, weeks: 6 })).reduce((s, r) => s + r.openQty, 0);

  it('pauses a one-off requirement: proposals withdrawn, out of matching and the board', async () => {
    const d = (
      await call(app, buyer, 'POST', '/v1/demand', { produceId: cabbage, quantity: 20, neededBy: days(3) })
    ).body;
    const [match] = await matchDemand(app.prisma, d.id);
    expect(match).toBeTruthy();
    expect(await onBoard()).toBe(20);

    const paused = await call(app, buyer, 'PATCH', `/v1/demand/${d.id}`, { status: 'PAUSED' });
    expect(paused.body.status).toBe('PAUSED');
    expect(await app.prisma.match.findUnique({ where: { id: match!.id } })).toBeNull(); // proposal withdrawn
    expect(await matchDemand(app.prisma, d.id)).toEqual([]);
    expect(await onBoard()).toBe(0);
    const again = await call(app, buyer, 'PATCH', `/v1/demand/${d.id}`, { status: 'PAUSED' });
    expect(again.body.error.code).toBe('DEMAND_ALREADY_PAUSED');

    const resumed = await call(app, buyer, 'PATCH', `/v1/demand/${d.id}`, { status: 'OPEN' });
    expect(resumed.body.status).toBe('OPEN');
    expect(await onBoard()).toBe(20);
    expect((await matchDemand(app.prisma, d.id)).length).toBe(1);
    const notPaused = await call(app, buyer, 'PATCH', `/v1/demand/${d.id}`, { status: 'OPEN' });
    expect(notPaused.body.error.code).toBe('DEMAND_NOT_PAUSED');
    await call(app, buyer, 'PATCH', `/v1/demand/${d.id}`, { status: 'CANCELLED' });
  });

  it('pauses a recurring requirement together with its upcoming dates, and resumes them', async () => {
    const t = (
      await call(app, buyer, 'POST', '/v1/demand', {
        produceId: cabbage,
        quantity: 10,
        neededBy: days(2),
        recurrence: 'FREQ=WEEKLY',
      })
    ).body;
    const children = () =>
      app.prisma.demandRequest.findMany({ where: { parentId: t.id }, select: { status: true } });
    expect((await children()).length).toBeGreaterThan(0);
    expect(await onBoard()).toBeGreaterThan(0);

    await call(app, buyer, 'PATCH', `/v1/demand/${t.id}`, { status: 'PAUSED' });
    expect((await children()).every((c) => c.status === 'PAUSED')).toBe(true);
    expect(await onBoard()).toBe(0);
    const list = await call(app, buyer, 'GET', '/v1/demand?status=PAUSED');
    expect(list.body.items.map((i: any) => i.id)).toContain(t.id);

    await call(app, buyer, 'PATCH', `/v1/demand/${t.id}`, { status: 'OPEN' });
    expect((await children()).every((c) => c.status === 'OPEN')).toBe(true);
    expect(await onBoard()).toBeGreaterThan(0);
  });
});
