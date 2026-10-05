import { deliverySlots, dropoffsByWindow } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, closeApp, days, emailUser, makeApp, nextPhone, phoneUser, produceId } from './helpers.js';

/** B09: delivery dates and windows, the next-day cut-off, and drop-offs ordered by window. */
describe('delivery slots', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => closeApp(app));

  // 10:00 and 17:00 in Nairobi (UTC+3) on Monday 5 October 2026.
  const morning = new Date('2026-10-05T07:00:00Z');
  const evening = new Date('2026-10-05T14:00:00Z');

  it('opens tomorrow before the 16:00 cut-off and the day after once it has passed', async () => {
    const am = await deliverySlots(app.prisma, { days: 3, now: morning });
    expect(am.earliestDate).toBe('2026-10-06');
    expect(am.days.map((d) => [d.date, d.available])).toEqual([
      ['2026-10-05', false],
      ['2026-10-06', true],
      ['2026-10-07', true],
    ]);
    expect(am.days[0]!.windows[0]!.reason).toMatch(/before 16:00/);
    expect(am.days[1]!.windows.map((w) => w.window)).toEqual([
      '06:00-08:00',
      '08:00-10:00',
      '10:00-12:00',
      '14:00-16:00',
    ]);

    const pm = await deliverySlots(app.prisma, { days: 3, now: evening });
    expect(pm.earliestDate).toBe('2026-10-07');
    expect(pm.days[1]).toMatchObject({ date: '2026-10-06', available: false });
  });

  it('serves the slots over HTTP', async () => {
    const u = await emailUser(app);
    const r = await call(app, u, 'GET', '/v1/delivery/slots?days=5');
    expect(r.status).toBe(200);
    expect(r.body.days).toHaveLength(5);
    expect(r.body.days.some((d: any) => d.available)).toBe(true);
    expect(r.body.cutoffHour).toBe(16);
  });

  it('orders drop-offs by delivery window, nearest first within a window', () => {
    const start = { lat: -1.28, lng: 36.82 };
    const near = { lat: -1.29, lng: 36.82 };
    const far = { lat: -1.4, lng: 36.9 };
    const { ordered } = dropoffsByWindow(start, [
      { key: 'late-near', point: near, window: '14:00-16:00' },
      { key: 'early-far', point: far, window: '06:00-08:00' },
      { key: 'early-near', point: near, window: '06:00-08:00' },
      { key: 'none', point: near, window: null },
    ]);
    expect(ordered.map((s) => s.key)).toEqual(['early-near', 'early-far', 'late-near', 'none']);
  });

  it('keeps a direct order window, rejects unknown windows, and shows it in tracking', async () => {
    const buyer = await emailUser(app, undefined, 'Window Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Window Cafe',
      buyerCategory: 'RESTAURANT',
      county: 'Nairobi',
    });
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Window Farmer',
      county: 'Kiambu',
      farm: { name: 'Window Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    const listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'onions-red'),
        quantity: 50,
        pricePerUnit: 9000,
        availableFrom: days(0),
        availableTo: days(6),
      })
    ).body.id;
    const bad = await call(app, buyer, 'POST', '/v1/orders', {
      listingId,
      quantity: 1,
      deliveryWindow: '03:00-04:00',
    });
    expect(bad.body.error.code).toBe('DELIVERY_SLOT_UNAVAILABLE');
    const o = await call(app, buyer, 'POST', '/v1/orders', {
      listingId,
      quantity: 1,
      deliveryDate: days(2),
      deliveryWindow: '10:00-12:00',
    });
    expect(o.body.deliveryWindow).toBe('10:00-12:00');
    const t = await call(app, buyer, 'GET', `/v1/orders/${o.body.id}/tracking`);
    expect(t.body).toMatchObject({ route: null, deliveryWindow: '10:00-12:00' });
    expect(t.body.deliveryDate).toMatch(/T/);
  });
});
