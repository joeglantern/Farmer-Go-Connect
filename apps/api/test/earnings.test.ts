import { nairobiDate } from '@farmgo/core';
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

/** B16: monthly earnings for farmers and suppliers. */
describe('earnings summary', () => {
  let app: FastifyInstance;
  let farmer: Session;
  const orders: string[] = [];

  const lastMonth = () => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    d.setUTCDate(15);
    return d;
  };

  beforeAll(async () => {
    app = await makeApp();
    farmer = await phoneUser(app, nextPhone());
    const buyer = await emailUser(app, undefined, 'Earn Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Earn Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Earn Farmer',
      county: 'Kiambu',
      farm: { name: 'Earn Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    const listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'ginger'),
        quantity: 100,
        pricePerUnit: 10_000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
    for (let i = 0; i < 3; i++) {
      orders.push((await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 1 })).body.id);
    }
    const payout = (orderId: string, status: 'SUCCESS' | 'PENDING', createdAt: Date, gross: number) =>
      app.prisma.payout.create({
        data: {
          orderId,
          farmerId: farmer.userId,
          phoneNumber: '+254700000009',
          grossAmount: gross,
          commission: gross * 0.08,
          amount: gross * 0.92,
          status,
          idempotencyKey: `earn-${orderId}`,
          createdAt,
        },
      });
    await payout(orders[0]!, 'SUCCESS', new Date(), 100_000);
    await payout(orders[1]!, 'SUCCESS', lastMonth(), 50_000);
    await payout(orders[2]!, 'PENDING', new Date(), 20_000);
  });
  afterAll(async () => closeApp(app));

  it('sums paid-out money per Nairobi month, newest first', async () => {
    const r = await call(app, farmer, 'GET', '/v1/earnings?months=3');
    expect(r.status).toBe(200);
    expect(r.body.months).toHaveLength(3);
    expect(r.body.months[0]).toMatchObject({
      month: nairobiDate(new Date()).slice(0, 7),
      grossCents: 100_000,
      commissionCents: 8_000,
      netCents: 92_000,
      orders: 1,
    });
    expect(r.body.months[1]).toMatchObject({ grossCents: 50_000, orders: 1 });
    expect(r.body.months[2]).toMatchObject({ grossCents: 0, orders: 0 });
    expect(r.body.totals).toEqual({
      grossCents: 150_000,
      commissionCents: 12_000,
      netCents: 138_000,
      orders: 2,
    });
    expect(r.body.pendingCents).toBe(18_400); // the payout being sent
    const one = await call(app, farmer, 'GET', '/v1/earnings?months=1');
    expect(one.body.totals.orders).toBe(1);
  });

  it('gives suppliers their own green-input earnings', async () => {
    const supplier = await emailUser(app, undefined, 'Earn Supplier');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Earn Compost',
      county: 'Kiambu',
    });
    const r = await call(app, supplier, 'GET', '/v1/earnings?as=supplier');
    expect(r.status).toBe(200);
    expect(r.body.months).toHaveLength(6);
    expect(r.body.totals.orders).toBe(0);
    expect((await call(app, supplier, 'GET', '/v1/earnings')).status).toBe(403); // not a farmer
  });
});
