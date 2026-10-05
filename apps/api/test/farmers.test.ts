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

/** B06: public farmer profiles and featured farmers, never exposing private details. */
describe('public farmer profiles', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let top: { session: Session; phone: string; profileId: string };
  let quiet: { session: Session; profileId: string };
  const county = 'Nyandarua'; // a county no other test lists in, so featured results are ours

  async function farmer(name: string, opts: { female?: boolean; organic?: boolean; list?: boolean }) {
    const phone = nextPhone();
    const s = await phoneUser(app, phone);
    await call(app, s, 'POST', '/v1/onboarding/farmer', {
      name,
      county,
      gender: opts.female ? 'FEMALE' : 'MALE',
      dateOfBirth: '2000-05-01',
      farm: {
        name: `${name.split(' ')[0]} Shamba`,
        county,
        ward: 'Ol Kalou',
        lat: -0.27,
        lng: 36.38,
        isOrganic: !!opts.organic,
        photoKey: `produce-photos/${s.userId}/farm.jpg`,
      },
    });
    const farmId = (await call(app, s, 'GET', '/v1/farms')).body[0].id;
    if (opts.list) {
      await call(app, s, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'potatoes'),
        quantity: 200,
        pricePerUnit: 4500,
        availableFrom: days(0),
        availableTo: days(8),
      });
    }
    const profileId = (await app.prisma.farmerProfile.findUniqueOrThrow({ where: { userId: s.userId } })).id;
    return { session: s, phone, profileId };
  }

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Curious Buyer');
    top = await farmer('Wanjiku Kamau', { female: true, organic: true, list: true });
    quiet = await farmer('Otieno Ouma', { list: true });
    await farmer('Idle Farmer', { list: false });
    await app.prisma.farmerProfile.update({
      where: { id: top.profileId },
      data: { ratingAvg: 4.9, kycStatus: 'VERIFIED' },
    });
    await app.prisma.farmerProfile.update({
      where: { id: quiet.profileId },
      data: { ratingAvg: 3.1, qaPassRate: 0.7 },
    });
  });
  afterAll(async () => closeApp(app));

  it('features farmers with produce on offer, best first, filtered by county', async () => {
    const r = await call(app, buyer, 'GET', `/v1/farmers/featured?county=${county}&limit=5`);
    expect(r.status).toBe(200);
    expect(r.body.map((f: any) => f.firstName)).toEqual(['Wanjiku', 'Otieno']); // the idle farmer lists nothing
    expect(r.body[0]).toMatchObject({
      id: top.profileId,
      farmName: 'Wanjiku Shamba',
      county,
      activeListings: 1,
      badges: ['youth', 'woman_led', 'organic', 'verified'],
    });
    expect(r.body[0].photoUrl).toMatch(/farm\.jpg$/);
  });

  it('shows a public profile with farms, track record and listings', async () => {
    const r = await call(app, buyer, 'GET', `/v1/farmers/${top.profileId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      firstName: 'Wanjiku',
      rating: 4.9,
      ordersCompleted: 0,
      badges: ['youth', 'woman_led', 'organic', 'verified'],
    });
    expect(r.body.farms[0]).toMatchObject({ name: 'Wanjiku Shamba', ward: 'Ol Kalou', isOrganic: true });
    expect(r.body.activeListings[0].produce.name).toBe('Potatoes');
    expect(r.body.memberSince).toMatch(/T/);
  });

  it('never exposes phone numbers, coordinates, date of birth or the surname', async () => {
    for (const url of [`/v1/farmers/${top.profileId}`, `/v1/farmers/featured?county=${county}`]) {
      const text = JSON.stringify((await call(app, buyer, 'GET', url)).body);
      expect(text).not.toContain(top.phone);
      expect(text).not.toMatch(/\+2547/);
      expect(text).not.toMatch(/"lat"|"lng"|dateOfBirth|2000-05-01|mpesa|Kamau|nationalId/i);
    }
  });

  it('404s for unknown farmers and requires sign-in', async () => {
    expect((await call(app, buyer, 'GET', '/v1/farmers/nope')).status).toBe(404);
    expect((await call(app, null, 'GET', `/v1/farmers/${top.profileId}`)).status).toBe(401);
  });
});
