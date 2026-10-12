import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELIVERY_CODE_TEST_KEY } from '../src/modules/logistics.routes.js';
import {
  call,
  closeApp,
  days,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  postListing,
  produceId,
  type Session,
} from './helpers.js';

/** Proof of delivery by SMS code, for recipients who cannot sign. */
describe('delivery code', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let driver: Session;
  let listingId: string;
  let seq = 0;

  /** A fresh order on a started route: pickup done, drop-off waiting. */
  async function stops() {
    const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 1 })).body;
    await app.prisma.order.update({ where: { id: order.id }, data: { status: 'IN_TRANSIT' } });
    seq += 1;
    const route = await app.prisma.route.create({
      data: {
        code: `RT-DC-${Date.now()}-${seq}`,
        driverId: driver.userId,
        date: new Date(),
        county: 'Nairobi',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });
    const pickup = await app.prisma.delivery.create({
      data: {
        routeId: route.id,
        orderId: order.id,
        kind: 'PICKUP',
        sequence: 1,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    const dropoff = await app.prisma.delivery.create({
      data: { routeId: route.id, orderId: order.id, kind: 'DROPOFF', sequence: 2 },
    });
    return { order, route, pickup, dropoff };
  }

  const send = (stopId: string, as: Session = driver) =>
    call(app, as, 'POST', `/v1/stops/${stopId}/delivery-code`);
  const sentCode = async (stopId: string) => (await app.redis.get(DELIVERY_CODE_TEST_KEY(stopId)))!;
  const wrong = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, '0');
  const complete = (stopId: string, deliveryCode?: string) =>
    call(app, driver, 'POST', `/v1/stops/${stopId}/complete`, deliveryCode ? { deliveryCode } : {});

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Code Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Code Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      phone: '0712345678',
    });
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Code Farmer',
      county: 'Kiambu',
      farm: { name: 'Code Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await postListing(app, farmer, {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 500,
        pricePerUnit: 3000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
    driver = await emailUser(app, 'driver', 'Code Driver');
  });
  afterAll(async () => closeApp(app));

  it('texts a code to the buyer and shows the masked number', async () => {
    const { dropoff } = await stops();
    const r = await send(dropoff.id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sentTo: '+254 7** *** 678' });
    expect(await sentCode(dropoff.id)).toMatch(/^\d{4}$/);
    const row = await app.prisma.delivery.findUniqueOrThrow({ where: { id: dropoff.id } });
    expect(row.deliveryCodeHash).toBeTruthy();
    expect(row.deliveryCodeHash).not.toContain(await sentCode(dropoff.id));
    expect(row.deliveryCodeSentAt).toBeTruthy();
  });

  it('refuses a wrong code and counts it, then the right code completes the stop', async () => {
    const { dropoff, order } = await stops();
    await send(dropoff.id);
    const code = await sentCode(dropoff.id);

    const bad = await complete(dropoff.id, wrong(code));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('DELIVERY_CODE_WRONG');
    expect(
      (await app.prisma.delivery.findUniqueOrThrow({ where: { id: dropoff.id } })).deliveryCodeAttempts,
    ).toBe(1);

    const ok = await complete(dropoff.id, code);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('COMPLETED');
    expect(ok.body.codeConfirmedAt).toBeTruthy();
    expect(ok.body.signatureKey).toBeNull();
    expect(ok.body).not.toHaveProperty('deliveryCodeHash');
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('DELIVERED');
  });

  it('still needs a photo, signature or code', async () => {
    const { dropoff } = await stops();
    const r = await complete(dropoff.id);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('POD_REQUIRED');
    const notSent = await complete(dropoff.id, '1234');
    expect(notSent.status).toBe(409);
    expect(notSent.body.error.code).toBe('DELIVERY_CODE_NOT_SENT');
  });

  it('locks the code after 5 wrong tries until a new one is sent', async () => {
    const { dropoff } = await stops();
    await send(dropoff.id);
    const code = await sentCode(dropoff.id);
    for (let i = 0; i < 5; i++) {
      const r = await complete(dropoff.id, wrong(code));
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('DELIVERY_CODE_WRONG');
    }
    const locked = await complete(dropoff.id, code);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('DELIVERY_CODE_LOCKED');

    // A new code (after the 30 seconds) works again.
    await app.prisma.delivery.update({
      where: { id: dropoff.id },
      data: { deliveryCodeSentAt: new Date(Date.now() - 31_000) },
    });
    expect((await send(dropoff.id)).status).toBe(200);
    const fresh = await sentCode(dropoff.id);
    const ok = await complete(dropoff.id, fresh);
    expect(ok.status).toBe(200);
    expect(ok.body.codeConfirmedAt).toBeTruthy();
  });

  it('sends at most one code every 30 seconds', async () => {
    const { dropoff } = await stops();
    expect((await send(dropoff.id)).status).toBe(200);
    const again = await send(dropoff.id);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('DELIVERY_CODE_TOO_SOON');
    await app.prisma.delivery.update({
      where: { id: dropoff.id },
      data: { deliveryCodeSentAt: new Date(Date.now() - 31_000) },
    });
    expect((await send(dropoff.id)).status).toBe(200);
  });

  it('refuses pickups, routes not started, and other drivers', async () => {
    const { pickup, dropoff, route } = await stops();
    const p = await send(pickup.id);
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('DELIVERY_CODE_NOT_AVAILABLE');

    const other = await emailUser(app, 'driver', 'Other Driver');
    expect((await send(dropoff.id, other)).status).toBe(403);
    expect((await send(dropoff.id, buyer)).status).toBe(403);

    await app.prisma.route.update({ where: { id: route.id }, data: { status: 'PLANNED' } });
    const planned = await send(dropoff.id);
    expect(planned.status).toBe(409);
    expect(planned.body.error.code).toBe('DELIVERY_CODE_NOT_AVAILABLE');
  });
});
