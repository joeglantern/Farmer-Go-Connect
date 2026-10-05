import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncAuthUser } from '../src/lib/auth-sync.js';
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

/** B08: saved delivery addresses with one default, shared within a buyer organization. */
describe('saved addresses', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let colleague: Session;
  let orgId: string;
  let listingId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Address Buyer');
    colleague = await emailUser(app, 'buyer', 'Address Chef');
    orgId = (
      await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Address Hotel',
        buyerCategory: 'HOTEL',
        county: 'Nairobi',
        address: 'HQ, Upper Hill',
      })
    ).body.organization.id;
    await app.prisma.member.create({
      data: { id: randomUUID(), organizationId: orgId, userId: colleague.userId, role: 'member' },
    });
    await syncAuthUser(app, colleague.userId);
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Address Farmer',
      county: 'Kiambu',
      farm: { name: 'Address Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 100,
        pricePerUnit: 2500,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('keeps exactly one default, and moves it on request or delete', async () => {
    const first = await call(app, buyer, 'POST', '/v1/addresses', {
      label: 'Main kitchen',
      county: 'Nairobi',
      line1: 'Serena back gate',
      landmark: 'Opposite Uhuru Park',
      instructions: 'Ask for Chef Peter',
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ isDefault: true, orgId }); // the first address is the default
    const second = await call(app, buyer, 'POST', '/v1/addresses', {
      label: 'Branch',
      county: 'Nairobi',
      line1: 'Westlands',
    });
    expect(second.body.isDefault).toBe(false);

    await call(app, buyer, 'PATCH', `/v1/addresses/${second.body.id}`, { isDefault: true });
    let list = (await call(app, buyer, 'GET', '/v1/addresses')).body;
    expect(list.map((a: any) => [a.label, a.isDefault])).toEqual([
      ['Branch', true],
      ['Main kitchen', false],
    ]);

    // Turning the default off is ignored: there is always one while any address exists.
    await call(app, buyer, 'PATCH', `/v1/addresses/${second.body.id}`, {
      isDefault: false,
      label: 'Westlands branch',
    });
    list = (await call(app, buyer, 'GET', '/v1/addresses')).body;
    expect(list[0]).toMatchObject({ label: 'Westlands branch', isDefault: true });

    expect((await call(app, buyer, 'DELETE', `/v1/addresses/${second.body.id}`)).status).toBe(200);
    list = (await call(app, buyer, 'GET', '/v1/addresses')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: 'Main kitchen', isDefault: true });
  });

  it('shares a buyer organization addresses between members and hides them from others', async () => {
    const chef = await call(app, colleague, 'GET', '/v1/addresses', undefined, { 'x-org-id': orgId });
    expect(chef.body.map((a: any) => a.label)).toEqual(['Main kitchen']);
    const other = await emailUser(app, undefined, 'Other Buyer');
    await call(app, other, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Other Cafe',
      buyerCategory: 'RESTAURANT',
      county: 'Nairobi',
    });
    expect((await call(app, other, 'GET', '/v1/addresses')).body).toEqual([]);
    const id = chef.body[0].id;
    expect((await call(app, other, 'PATCH', `/v1/addresses/${id}`, { label: 'Mine now' })).status).toBe(404);
  });

  it('lets farmers keep personal addresses', async () => {
    const f = await phoneUser(app, nextPhone());
    await call(app, f, 'POST', '/v1/onboarding/farmer', { name: 'Home Farmer', county: 'Nyeri' });
    const r = await call(app, f, 'POST', '/v1/addresses', {
      label: 'Home',
      county: 'Nyeri',
      line1: 'Othaya road',
    });
    expect(r.body).toMatchObject({ orgId: null, userId: f.userId, isDefault: true });
  });

  it('uses a saved address at checkout, and the default one when none is given', async () => {
    const saved = (await call(app, buyer, 'GET', '/v1/addresses')).body[0];
    const base = {
      deliveryDate: days(3),
      deliveryWindow: '08:00-10:00',
      paymentMethod: 'MPESA',
      phoneNumber: '0712345678',
    };
    const withId = await call(app, buyer, 'POST', '/v1/checkout', {
      ...base,
      items: [{ listingId, quantity: 1 }],
      addressId: saved.id,
    });
    expect(withId.status).toBe(201);
    const o1 = await app.prisma.order.findFirstOrThrow({ where: { checkoutId: withId.body.checkoutId } });
    expect(o1.deliveryAddress).toBe('Serena back gate, Opposite Uhuru Park, Nairobi');

    const byDefault = await call(
      app,
      colleague,
      'POST',
      '/v1/checkout',
      { ...base, items: [{ listingId, quantity: 1 }] },
      { 'x-org-id': orgId },
    );
    const o2 = await app.prisma.order.findFirstOrThrow({ where: { checkoutId: byDefault.body.checkoutId } });
    expect(o2.deliveryAddress).toBe('Serena back gate, Opposite Uhuru Park, Nairobi');

    const unknown = await call(app, buyer, 'POST', '/v1/checkout/quote', {
      deliveryDate: base.deliveryDate,
      deliveryWindow: base.deliveryWindow,
      items: [{ listingId, quantity: 1 }],
      addressId: 'not-mine',
    });
    expect(unknown.body.error.code).toBe('ADDRESS_NOT_FOUND');
  });
});
