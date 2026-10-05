import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, closeApp, days, emailUser, makeApp, nextPhone, phoneUser, produceId } from './helpers.js';

/** B03: the home grid's eight category tiles with live counts. */
describe('app categories', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => closeApp(app));

  const counts = async () => {
    const r = await call(app, null, 'GET', '/v1/categories');
    expect(r.status).toBe(200);
    return Object.fromEntries(r.body.map((c: any) => [c.slug, c.count])) as Record<string, number>;
  };

  it('returns the eight tiles in display order, with the groupings the app expects', async () => {
    const r = await call(app, null, 'GET', '/v1/categories');
    expect(r.body.map((c: any) => c.slug)).toEqual([
      'vegetables',
      'fruits',
      'meat-poultry',
      'dairy',
      'grains-staples',
      'value-added',
      'natural-fertilizers',
      'all',
    ]);
    const bySlug = Object.fromEntries(r.body.map((c: any) => [c.slug, c]));
    expect(bySlug['meat-poultry'].produceCategories).toEqual(['MEAT', 'POULTRY']);
    expect(bySlug['grains-staples'].produceCategories).toEqual(['GRAIN', 'LEGUME', 'TUBER']);
    expect(bySlug['natural-fertilizers']).toMatchObject({
      source: 'inputs',
      inputCategories: ['COMPOST', 'ORGANIC_FERTILIZER', 'BIOPESTICIDE', 'SEEDLINGS'],
    });
    expect(bySlug['value-added'].nameSw).toBe('Bidhaa Zilizoongezwa Thamani');
  });

  it('seeds meat and value-added produce with Kiswahili names', async () => {
    const honey = await app.prisma.produce.findUniqueOrThrow({ where: { slug: 'honey' } });
    expect(honey).toMatchObject({ category: 'VALUE_ADDED', nameSw: 'Asali' });
    const beef = await app.prisma.produce.findUniqueOrThrow({ where: { slug: 'beef' } });
    expect(beef.category).toBe('MEAT');
  });

  it('counts open listings per tile and active input products for fertilizers', async () => {
    const before = await counts();
    const farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Tile Farmer',
      county: 'Kiambu',
      farm: { name: 'Tile Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    for (const slug of ['honey', 'beef', 'chicken', 'kale']) {
      const l = await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, slug),
        quantity: 10,
        pricePerUnit: 50_000,
        availableFrom: days(0),
        availableTo: days(5),
      });
      expect(l.status).toBe(201);
    }
    const supplier = await emailUser(app, undefined, 'Tile Compost');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Tile Compost',
      county: 'Kiambu',
    });
    await call(app, supplier, 'POST', '/v1/inputs', {
      name: 'Tile compost',
      category: 'COMPOST',
      unit: 'BAG',
      pricePerUnit: 40_000,
      stock: 5,
      county: 'Kiambu',
    });
    const after = await counts();
    expect(after['value-added']! - before['value-added']!).toBe(1);
    expect(after['meat-poultry']! - before['meat-poultry']!).toBe(2);
    expect(after.vegetables! - before.vegetables!).toBe(1);
    expect(after.all! - before.all!).toBe(4);
    expect(after['natural-fertilizers']! - before['natural-fertilizers']!).toBe(1);
  });
});
