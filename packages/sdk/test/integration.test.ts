import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app.js';
import { OTP_TEST_KEY } from '../../../apps/api/src/plugins/auth.js';
import { PRODUCE } from '../../../apps/api/src/scripts/catalog.js';
// Relative so the SDK manifest stays free of server dependencies; resolution happens from packages/core.
import { closeQueues, relayOutboxBatch, routeEvent } from '../../core/src/index.js';
import { ApiError, createApi, createRealtime, type FarmGoApi, formatKes } from '../src/index.js';

/**
 * The SDK against the real API over HTTP (and a real WebSocket), on the shared test database.
 * Mirrors apps/api/test/helpers.ts: users are created fresh with random identities.
 */
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

describe('@farmgo/sdk against the real API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let buyerToken: string | null = null;
  let farmerToken: string | null = null;
  let buyer: FarmGoApi;
  let farmer: FarmGoApi;
  let farmId: string;
  let listingId: string;
  let orderId: string;
  const unauthorized: ApiError[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false, docs: false });
    await app.ready();
    if ((await app.prisma.produce.count()) === 0) {
      for (const p of PRODUCE) await app.prisma.produce.create({ data: p });
    }
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    buyer = createApi({
      baseUrl,
      getToken: () => buyerToken,
      headers: { origin: ORIGIN },
      language: 'en',
      onUnauthorized: (e) => unauthorized.push(e),
    });
    farmer = createApi({ baseUrl, getToken: () => farmerToken, headers: { origin: ORIGIN } });
  });

  afterAll(async () => {
    await app.close();
    await closeQueues();
  });

  it('signs a buyer up and in through the SDK', async () => {
    const email = `${randomUUID().slice(0, 8)}@test.farmgo`;
    const signedUp = await buyer.auth.signUpEmail({ email, password: PASSWORD, name: 'SDK Hotel' });
    expect(signedUp.token).toBeTruthy();
    const signedIn = await buyer.auth.signInEmail({ email, password: PASSWORD });
    expect(signedIn.user.id).toBe(signedUp.user.id);
    buyerToken = signedIn.token;

    const bad = await buyer.auth.signInEmail({ email, password: 'wrong-password' }).catch((e: unknown) => e);
    expect(ApiError.is(bad)).toBe(true);
    expect((bad as ApiError).status).toBe(401);
  });

  it('me: needsOnboarding, then onboards as a hotel', async () => {
    const before = await buyer.me.get();
    expect(before.needsOnboarding).toBe(true);
    expect(before.user.role).toBe('user');

    const onboarded = await buyer.onboarding.buyer({
      businessName: 'SDK Serena',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      lat: -1.2921,
      lng: 36.8219,
    });
    expect(onboarded.organization.id).toBeTruthy();
    expect(onboarded.profile.type).toBe('BUYER');

    const me = await buyer.me.get();
    expect(me.user.role).toBe('buyer');
    expect(me.permissions).toContain('order:create');
    expect(me.organizations).toHaveLength(1);
    expect(me.organizations[0]?.id).toBe(onboarded.organization.id);
  });

  it('a farmer signs in by phone OTP, onboards and lists produce', async () => {
    const phone = `+2547${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await farmer.auth.sendOtp({ phoneNumber: phone });
    const code = await app.redis.get(OTP_TEST_KEY(phone));
    expect(code).toBeTruthy();
    const session = await farmer.auth.verifyOtp({ phoneNumber: phone, code: code! });
    farmerToken = session.token;

    await farmer.onboarding.farmer({
      name: 'Mary Wambui',
      county: 'Kiambu',
      gender: 'FEMALE',
      dateOfBirth: new Date('1999-03-01'),
      farm: { name: 'Wambui Greens', county: 'Kiambu', lat: -1.1714, lng: 36.8356, acreage: 2 },
    });
    const farms = await farmer.farms.list();
    expect(farms).toHaveLength(1);
    farmId = farms[0]!.id;

    const produce = await farmer.produce.list({ q: 'tomato' });
    const tomatoes = produce.find((p) => p.slug === 'tomatoes') ?? produce[0]!;
    const listing = await farmer.supply.create({
      farmId,
      produceId: tomatoes.id,
      quantity: 500,
      grade: 'A',
      pricePerUnit: 8000,
      availableFrom: new Date(),
      availableTo: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(listing.quantityLeft).toBe(500);
    expect(listing.produce.id).toBe(tomatoes.id);
    listingId = listing.id;
  });

  it('supply.list: the buyer sees the listing with the farmer redacted to a first name', async () => {
    const page = await buyer.supply.list({ county: 'Kiambu', limit: 50 });
    const mine = page.items.find((l) => l.id === listingId);
    expect(mine).toBeTruthy();
    expect(mine!.farm.farmer.user.name).toBe('Mary');
    expect(mine!.farm.farmer.kycStatus).toBe('PENDING');
    expect(page.nextCursor === null || typeof page.nextCursor === 'string').toBe(true);
  });

  it('orders.create with an idempotency key, then a replay returns the same order', async () => {
    const key = randomUUID();
    const order = await buyer.orders.create({ listingId, quantity: 10 }, { idempotencyKey: key });
    expect(order.status).toBe('PENDING');
    expect(order.subtotal).toBe(10 * 8000);
    expect(formatKes(order.total)).toBe('KES 1,100');
    orderId = order.id;

    const replay = await buyer.http.request<{ id: string }>('POST', '/v1/orders', {
      body: { listingId, quantity: 10 },
      idempotencyKey: key,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.data.id).toBe(orderId);

    const detail = await buyer.orders.get(orderId);
    expect(detail.viewer).toBe('buyer');
    expect(detail.allowedTransitions).toContain('CANCELLED');
    expect(detail.items[0]?.listing.produce.name).toBe('Tomatoes');
  });

  it('errors arrive as ApiError with the server code and request id', async () => {
    const err = (await buyer.orders.create({ listingId, quantity: -1 }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.requestId).toBeTruthy();
    expect(err.issues.length).toBeGreaterThan(0);

    const missing = (await buyer.orders.get('nope').catch((e: unknown) => e)) as ApiError;
    expect(missing.status).toBe(404);
    expect(missing.code).toBe('NOT_FOUND');

    const anonUnauthorized: ApiError[] = [];
    const anon = createApi({
      baseUrl,
      getToken: () => null,
      onUnauthorized: (e) => anonUnauthorized.push(e),
    });
    await expect(anon.me.get()).rejects.toMatchObject({ status: 401 });
    expect(anonUnauthorized).toHaveLength(1);
    // The buyer client saw one 401 too: the wrong-password sign-in earlier.
    expect(unauthorized).toHaveLength(1);
  });

  it('realtime: connects over the real WebSocket and receives the farmer confirmation', async () => {
    const wsEvents: unknown[] = [];
    const rt = createRealtime({
      url: `${baseUrl}/ws`,
      getToken: () => buyerToken,
      onUnauthorized: () => wsEvents.push('unauthorized'),
      onError: (e) => wsEvents.push(e),
    });
    rt.status.subscribe((s) => wsEvents.push(s));
    const opened = new Promise<void>((resolve) => {
      const off = rt.status.subscribe((s) => {
        if (s === 'open') {
          off();
          resolve();
        }
      });
    });
    const event = new Promise<{ type: string; data: unknown; seq: number }>((resolve) => {
      rt.subscribe(`order:${orderId}`, (e) => {
        if (e.type === 'order.status_changed') resolve(e);
      });
    });
    rt.connect();
    await Promise.race([
      opened,
      new Promise((_r, rej) =>
        setTimeout(() => rej(new Error(`ws never opened: ${JSON.stringify(wsEvents)}`)), 8000),
      ),
    ]);

    await farmer.orders.confirm(orderId);
    // The worker is not running in tests: relay the outbox by hand, like apps/api/test does.
    let n: number;
    do n = await relayOutboxBatch(app.prisma, (row) => routeEvent(app.prisma, app.redis, row));
    while (n > 0);

    const e = await Promise.race([
      event,
      new Promise<never>((_r, rej) =>
        setTimeout(() => rej(new Error(`no order event: ${JSON.stringify(wsEvents)}`)), 10_000),
      ),
    ]);
    expect(e.data).toMatchObject({ orderId, to: 'CONFIRMED' });
    expect(rt.lastSeq(`order:${orderId}`)).toBe(e.seq);
    rt.close();
    expect(rt.status.get()).toBe('closed');
  });
});
