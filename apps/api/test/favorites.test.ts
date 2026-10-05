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

/** B12: favorites for listings, farmers, produce and categories. */
describe('favorites', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmerProfileId: string;
  let listingId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Fav Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Fav Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Neema Chebet',
      county: 'Nakuru',
      farm: { name: 'Chebet Farm', county: 'Nakuru', photoKey: `produce-photos/${farmer.userId}/farm.jpg` },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'avocados'),
        quantity: 50,
        pricePerUnit: 2000,
        availableFrom: days(0),
        availableTo: days(5),
      })
    ).body.id;
    farmerProfileId = (await app.prisma.farmerProfile.findUniqueOrThrow({ where: { userId: farmer.userId } }))
      .id;
  });
  afterAll(async () => closeApp(app));

  it('adds each kind once, with a title and image', async () => {
    const farmer = await call(app, buyer, 'POST', '/v1/favorites', {
      kind: 'FARMER',
      targetId: farmerProfileId,
    });
    expect(farmer.status).toBe(201);
    expect(farmer.body).toMatchObject({ title: 'Neema', subtitle: 'Chebet Farm, Nakuru', available: true });
    expect(farmer.body.imageUrl).toMatch(/farm\.jpg$/);
    const again = await call(app, buyer, 'POST', '/v1/favorites', {
      kind: 'FARMER',
      targetId: farmerProfileId,
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(farmer.body.id);

    await call(app, buyer, 'POST', '/v1/favorites', { kind: 'LISTING', targetId: listingId });
    await call(app, buyer, 'POST', '/v1/favorites', {
      kind: 'PRODUCE',
      targetId: await produceId(app, 'honey'),
    });
    const cat = await call(app, buyer, 'POST', '/v1/favorites', { kind: 'CATEGORY', targetId: 'fruits' });
    expect(cat.body).toMatchObject({ title: 'Fruits', titleSw: 'Matunda' });
    const missing = await call(app, buyer, 'POST', '/v1/favorites', { kind: 'CATEGORY', targetId: 'toys' });
    expect(missing.status).toBe(404);

    const list = await call(app, buyer, 'GET', '/v1/favorites');
    expect(list.body.map((f: any) => f.kind)).toEqual(['CATEGORY', 'PRODUCE', 'LISTING', 'FARMER']);
    expect((await call(app, buyer, 'GET', '/v1/favorites?kind=PRODUCE')).body[0].titleSw).toBe('Asali');
  });

  it('marks a closed listing unavailable', async () => {
    await app.prisma.supplyListing.update({ where: { id: listingId }, data: { status: 'CANCELLED' } });
    const list = await call(app, buyer, 'GET', '/v1/favorites?kind=LISTING');
    expect(list.body[0]).toMatchObject({ title: 'Avocados', available: false });
  });

  it('shows favorite categories and farmers on the buyer dashboard', async () => {
    const dash = await call(app, buyer, 'GET', '/v1/dashboard/buyer');
    expect(dash.body.favorites.map((f: any) => f.kind)).toEqual(['CATEGORY', 'FARMER']);
  });

  it('removes by id or by target, only your own', async () => {
    const list = (await call(app, buyer, 'GET', '/v1/favorites')).body;
    const other = await emailUser(app);
    await call(app, other, 'DELETE', `/v1/favorites/${list[0].id}`);
    expect((await call(app, buyer, 'GET', '/v1/favorites')).body).toHaveLength(4);
    await call(app, buyer, 'DELETE', `/v1/favorites/${list[0].id}`);
    await call(app, buyer, 'DELETE', `/v1/favorites?kind=FARMER&targetId=${farmerProfileId}`);
    expect((await call(app, buyer, 'GET', '/v1/favorites')).body.map((f: any) => f.kind)).toEqual([
      'PRODUCE',
      'LISTING',
    ]);
  });
});
