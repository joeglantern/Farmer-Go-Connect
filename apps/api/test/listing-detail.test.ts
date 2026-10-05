import { weekStart } from '@farmgo/core';
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

const COUNTY = 'Taita Taveta'; // no other test lists here

/** B15: listing detail with similar listings, price index, distance and tags. */
describe('listing detail enrichment', () => {
  let app: FastifyInstance;
  let buyer: Session;
  const ids: Record<string, string> = {};

  async function listing(
    key: string,
    farmName: string,
    lat: number,
    lng: number,
    opts: { organic?: boolean; price?: number; fromDays?: number },
  ) {
    const f = await phoneUser(app, nextPhone());
    await call(app, f, 'POST', '/v1/onboarding/farmer', {
      name: `${farmName} Owner`,
      county: COUNTY,
      farm: { name: farmName, county: COUNTY, lat, lng, isOrganic: !!opts.organic },
    });
    const farmId = (await call(app, f, 'GET', '/v1/farms')).body[0].id;
    const r = await call(app, f, 'POST', '/v1/supply', {
      farmId,
      produceId: await produceId(app, 'passion-fruit'),
      quantity: 50,
      pricePerUnit: opts.price ?? 10_000,
      availableFrom: days(opts.fromDays ?? 0),
      availableTo: days((opts.fromDays ?? 0) + 7),
    });
    ids[key] = r.body.id;
  }

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Voi Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Voi Lodge',
      buyerCategory: 'HOTEL',
      county: COUNTY,
      lat: -3.39,
      lng: 38.56,
    });
    await listing('main', 'Voi Organic', -3.4, 38.57, { organic: true, price: 11_000 }); // about 1.5 km
    await listing('near', 'Maktau Farm', -3.45, 38.5, {}); // about 9 km
    await listing('far', 'Taveta Farm', -3.4, 37.68, { fromDays: 20 }); // about 97 km, far in the future
    await app.prisma.pricePoint.create({
      data: {
        produceId: await produceId(app, 'passion-fruit'),
        county: COUNTY,
        week: weekStart(new Date()),
        avgPrice: 10_000,
        minPrice: 9_000,
        maxPrice: 12_000,
        volume: 100,
        sampleSize: 4,
      },
    });
  });
  afterAll(async () => closeApp(app));

  it('adds distance, tags, similar listings and the price index', async () => {
    const r = await call(app, buyer, 'GET', `/v1/supply/${ids.main}`);
    expect(r.status).toBe(200);
    expect(r.body.distanceKm).toBeGreaterThan(0.5);
    expect(r.body.distanceKm).toBeLessThan(3);
    expect(r.body.tags).toEqual(['fresh', 'organic', 'local']);
    expect(r.body.similar.map((l: any) => l.id)).toEqual([ids.near, ids.far]); // nearest first, never itself
    expect(r.body.similar[0].farm.farmer.user.name).toBe('Maktau'); // still first name only
    expect(r.body.priceIndex).toMatchObject({ county: COUNTY, avgPrice: 10_000, diffPct: 10 });
    expect(r.body.farm.farmer).toHaveProperty('qaPassRate');
    expect(r.body.farm.farmer).toHaveProperty('ordersCompleted');
  });

  it('tags only what applies', async () => {
    const far = await call(app, buyer, 'GET', `/v1/supply/${ids.far}`);
    expect(far.body.tags).toEqual([]); // ready in 20 days, not organic, about 97 km away
    const stranger = await emailUser(app);
    const noLocation = await call(app, stranger, 'GET', `/v1/supply/${ids.near}`);
    expect(noLocation.body.distanceKm).toBeNull();
    expect(noLocation.body.tags).toEqual(['fresh']);
    expect(noLocation.body.priceIndex.county).toBe(COUNTY); // falls back to the farm's county
  });
});
