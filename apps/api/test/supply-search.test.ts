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

const COUNTY = 'Lamu'; // no other test lists here, so every result below is ours

/** B05: supply search, filters, sorting and distance. */
describe('supply search', () => {
  let app: FastifyInstance;
  let buyer: Session;
  const ids: Record<string, string> = {};

  async function farm(name: string, lat: number | null, lng: number | null, organic = false) {
    const f = await phoneUser(app, nextPhone());
    await call(app, f, 'POST', '/v1/onboarding/farmer', {
      name: `${name} Mwangi`,
      county: COUNTY,
      farm: { name, county: COUNTY, isOrganic: organic, ...(lat !== null ? { lat, lng } : {}) },
    });
    return { f, farmId: (await call(app, f, 'GET', '/v1/farms')).body[0].id as string };
  }
  async function list(
    key: string,
    owner: { f: Session; farmId: string },
    slug: string,
    price: number,
    fromDays: number,
  ) {
    const r = await call(app, owner.f, 'POST', '/v1/supply', {
      farmId: owner.farmId,
      produceId: await produceId(app, slug),
      quantity: 100,
      pricePerUnit: price,
      availableFrom: days(fromDays),
      availableTo: days(fromDays + 7),
    });
    expect(r.status).toBe(201);
    ids[key] = r.body.id;
  }
  const search = async (qs: string, s: Session = buyer) => {
    const r = await call(app, s, 'GET', `/v1/supply?county=${COUNTY}&${qs}`);
    expect(r.status).toBe(200);
    return r.body as { items: any[]; nextCursor: string | null };
  };
  const keys = (items: any[]) => items.map((i) => Object.entries(ids).find(([, id]) => id === i.id)?.[0]);

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Search Buyer');
    // The buyer sits in Lamu town.
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Lamu Search Hotel',
      buyerCategory: 'HOTEL',
      county: COUNTY,
      lat: -2.27,
      lng: 40.9,
    });
    const near = await farm('Shela Organic', -2.29, 40.91, true); // about 2 km
    const mid = await farm('Mokowe Gardens', -2.24, 40.85); // about 6 km
    const far = await farm('Witu Farm', -2.39, 40.44); // about 50 km
    const unknown = await farm('Kiunga Plot', null, null); // no coordinates: county centre
    await list('nearMango', near, 'mangoes', 3000, 0);
    await list('midTomato', mid, 'tomatoes', 9000, 2);
    await list('farKale', far, 'kale', 1500, 1);
    await list('unknownHoney', unknown, 'honey', 60000, 0);
  });
  afterAll(async () => closeApp(app));

  it('sorts by distance with PostGIS, from the buyer organization by default', async () => {
    const r = await search('sort=nearest');
    // Kiunga Plot has no coordinates, so it sits at Lamu's county centre, right next to the buyer.
    expect(keys(r.items)).toEqual(['unknownHoney', 'nearMango', 'midTomato', 'farKale']);
    expect(r.items[0].distanceKm).toBeLessThan(1);
    expect(r.items[1].distanceKm).toBeGreaterThan(1);
    expect(r.items[1].distanceKm).toBeLessThan(4);
    expect(r.items[3].distanceKm).toBeGreaterThan(40);
    expect(r.items.every((i: any) => typeof i.distanceKm === 'number')).toBe(true);
  });

  it('measures from query coordinates, then from the default saved address', async () => {
    const atWitu = await search('sort=nearest&lat=-2.39&lng=40.44');
    expect(keys(atWitu.items)[0]).toBe('farKale');
    await call(app, buyer, 'POST', '/v1/addresses', {
      label: 'Witu store',
      county: COUNTY,
      line1: 'Witu',
      lat: -2.39,
      lng: 40.44,
    });
    const byAddress = await search('sort=nearest');
    expect(keys(byAddress.items)[0]).toBe('farKale');
  });

  it('sorts by price, newest and soonest', async () => {
    expect(keys((await search('sort=price_asc')).items)).toEqual([
      'farKale',
      'nearMango',
      'midTomato',
      'unknownHoney',
    ]);
    expect(keys((await search('sort=price_desc')).items)[0]).toBe('unknownHoney');
    expect(keys((await search('sort=newest')).items)[0]).toBe('unknownHoney');
    expect(keys((await search('sort=soonest')).items).at(-1)).toBe('midTomato');
  });

  it('searches produce in English and Kiswahili and farm names, typo tolerant', async () => {
    expect(keys((await search('q=nyanya')).items)).toEqual(['midTomato']);
    expect(keys((await search('q=tomatos')).items)).toEqual(['midTomato']);
    expect(keys((await search('q=shela')).items)).toEqual(['nearMango']);
    expect((await search('q=asali')).items[0].produce.slug).toBe('honey');
  });

  it('filters by app category and organic farms', async () => {
    expect(keys((await search('category=fruits')).items)).toEqual(['nearMango']);
    expect(keys((await search('category=value-added')).items)).toEqual(['unknownHoney']);
    expect((await search('category=all')).items).toHaveLength(4);
    expect(keys((await search('organic=true')).items)).toEqual(['nearMango']);
    expect((await search('organic=false')).items).toHaveLength(4);
    const bad = await call(app, buyer, 'GET', '/v1/supply?category=natural-fertilizers');
    expect(bad.body.error.code).toBe('UNKNOWN_CATEGORY');
  });

  it('pages with an opaque cursor and keeps farmer names redacted', async () => {
    const p1 = await search('sort=price_asc&limit=2');
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await search(`sort=price_asc&limit=2&cursor=${p1.nextCursor}`);
    expect(keys([...p1.items, ...p2.items])).toEqual(['farKale', 'nearMango', 'midTomato', 'unknownHoney']);
    expect(p2.nextCursor).toBeNull();
    expect(p1.items[0].farm.farmer.user.name).toBe('Witu'); // first name only
    expect(JSON.stringify(p1)).not.toContain('Mwangi');
  });

  it('asks for a location to sort by distance when none is known', async () => {
    const stranger = await emailUser(app);
    const r = await call(app, stranger, 'GET', `/v1/supply?county=${COUNTY}&sort=nearest`);
    expect(r.body.error.code).toBe('LOCATION_REQUIRED');
  });
});
