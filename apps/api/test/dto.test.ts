import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { ok } from '../src/lib/route.js';
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

/** Routes that are not part of the app contract (auth proxy, docs, ops, provider callbacks). */
const NOT_APP_FACING = /^\/(api\/auth|docs|admin\/queues|metrics|webhooks)/;

/**
 * B01: every app-facing route declares a response DTO from @farmgo/contracts, the DTO shows in
 * OpenAPI, and a payload that does not match its DTO fails loudly instead of leaking.
 */
describe('response DTOs', () => {
  describe('OpenAPI', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp({ logger: false });
      await app.ready();
    });
    afterAll(async () => closeApp(app));

    it('declares a success response schema on every /v1 and /health route', async () => {
      const doc = app.swagger() as {
        paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
      };
      const missing: string[] = [];
      let checked = 0;
      for (const [path, methods] of Object.entries(doc.paths)) {
        if (NOT_APP_FACING.test(path)) continue;
        for (const [method, op] of Object.entries(methods)) {
          checked++;
          const codes = Object.keys(op.responses ?? {});
          // A redirect (e.g. GET /v1/files/*) documents its 3xx and carries no body.
          if (codes.some((c) => /^3\d\d$/.test(c))) continue;
          const success = codes.find((c) => /^2\d\d$/.test(c));
          const body = success
            ? (op.responses![success] as { content?: Record<string, { schema?: object }> }).content?.[
                'application/json'
              ]?.schema
            : undefined;
          if (!body || Object.keys(body).length === 0) missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
      expect(checked).toBeGreaterThan(80);
      expect(missing).toEqual([]);
    });

    it('serves the OpenAPI document over HTTP', async () => {
      const r = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
      expect(r.statusCode).toBe(200);
      const doc = r.json();
      expect(doc.paths['/v1/favorites']).toBeTruthy();
      // Schema properties named like file keys are left alone by the file-URL serializer.
      expect(JSON.stringify(doc)).not.toContain('"imageUrl":null,"imageKey"');
    });

    it('documents the shared error body on every /v1 route', async () => {
      const doc = app.swagger() as {
        paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
      };
      for (const [path, methods] of Object.entries(doc.paths)) {
        if (!path.startsWith('/v1/')) continue;
        for (const op of Object.values(methods)) expect(op.responses).toHaveProperty('default');
      }
    });
  });

  describe('enforcement', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp({ logger: false, docs: false });
      const Dto = z.object({ total: z.number().int(), when: z.iso.datetime(), status: z.enum(['PAID']) });
      app.get('/__dto/good', { schema: { response: ok(Dto) } }, async () => ({
        total: 100,
        when: new Date('2026-09-26T08:00:00Z'),
        status: 'PAID',
        secret: 'must not leak',
      }));
      app.get('/__dto/bad', { schema: { response: ok(Dto) } }, async () => ({
        total: 'one hundred',
        when: new Date(),
        status: 'PAID',
      }));
      await app.ready();
    });
    afterAll(async () => closeApp(app));

    it('serializes dates as ISO strings and strips fields that are not in the DTO', async () => {
      const r = await app.inject({ method: 'GET', url: '/__dto/good' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ total: 100, when: '2026-09-26T08:00:00.000Z', status: 'PAID' });
    });

    it('fails with 500 INTERNAL when a response does not match its DTO', async () => {
      const r = await app.inject({ method: 'GET', url: '/__dto/bad' });
      expect(r.statusCode).toBe(500);
      expect(r.json().error.code).toBe('INTERNAL');
    });
  });

  /**
   * Walks the routes the other test files do not exercise, as the right role, so every DTO has
   * been checked against a real payload at least once.
   */
  describe('every app-facing route returns a payload that matches its DTO', () => {
    let app: FastifyInstance;
    let admin: Session;
    let buyer: Session;
    let farmer: Session;
    let supplier: Session;
    let driver: Session;
    let farmId: string;
    let listingId: string;
    let orderId: string;
    let demandId: string;
    let buyerOrgId: string;

    beforeAll(async () => {
      app = await makeApp();
      admin = await emailUser(app, 'admin', 'DTO Admin');
      buyer = await emailUser(app, undefined, 'DTO Buyer');
      supplier = await emailUser(app, undefined, 'DTO Supplier');
      driver = await emailUser(app, 'driver', 'DTO Driver');
      farmer = await phoneUser(app, nextPhone());
      const onboard = await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
        businessName: 'DTO Hotel',
        buyerCategory: 'HOTEL',
        county: 'Nairobi',
        lat: -1.29,
        lng: 36.82,
      });
      buyerOrgId = onboard.body.organization.id;
      await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
        businessName: 'DTO Compost',
        county: 'Kiambu',
      });
      await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
        name: 'Dto Farmer',
        county: 'Kiambu',
        farm: { name: 'DTO Farm', county: 'Kiambu', lat: -1.17, lng: 36.83 },
      });
      farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
      const listing = await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'kale'),
        quantity: 100,
        pricePerUnit: 2500,
        availableFrom: days(0),
        availableTo: days(7),
      });
      listingId = listing.body.id;
      orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 10 })).body.id;
      demandId = (
        await call(app, buyer, 'POST', '/v1/demand', {
          produceId: await produceId(app, 'kale'),
          quantity: 20,
          neededBy: days(3),
        })
      ).body.id;
    });
    afterAll(async () => closeApp(app));

    const expectOk = async (
      s: Session | null,
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url: string,
      body?: unknown,
      status = 200,
    ) => {
      const r = await call(app, s, method, url, body);
      expect({ url, status: r.status, body: r.status === status ? undefined : r.body }).toEqual({
        url,
        status,
        body: undefined,
      });
      return r.body;
    };

    it('profile and organizations', async () => {
      const me = await expectOk(buyer, 'GET', '/v1/me');
      expect(me.organizations[0].profile.type).toBe('BUYER');
      await expectOk(buyer, 'PATCH', '/v1/me', { preferredLanguage: 'en' });
      await expectOk(farmer, 'PATCH', '/v1/me/farmer-profile', { gender: 'MALE' });
      const org = await expectOk(buyer, 'GET', '/v1/orgs/current');
      expect(org.members[0].user.id).toBe(buyer.userId);
      await expectOk(buyer, 'PATCH', '/v1/orgs/current', { town: 'Westlands' });
      await expectOk(supplier, 'GET', '/v1/orgs/current');
    });

    it('catalog and farms', async () => {
      const produce = await expectOk(buyer, 'GET', '/v1/produce?q=sukuma');
      expect(produce[0].nameSw).toMatch(/sukuma/i);
      await expectOk(buyer, 'GET', `/v1/produce/${produce[0].id}`);
      const created = await expectOk(
        admin,
        'POST',
        '/v1/produce',
        {
          slug: 'dto-test-crop',
          name: 'DTO test crop',
          nameSw: 'Zao la majaribio',
          category: 'OTHER',
          unit: 'KG',
        },
        201,
      );
      await expectOk(admin, 'PATCH', `/v1/produce/${created.id}`, { active: false });
      const farm = await expectOk(farmer, 'GET', `/v1/farms/${farmId}`);
      expect(farm.listings).toHaveLength(1);
      await expectOk(farmer, 'PATCH', `/v1/farms/${farmId}`, { ward: 'Kikuyu' });
    });

    it('supply and demand', async () => {
      const mine = await expectOk(farmer, 'GET', '/v1/supply?mine=true');
      expect(mine.items[0].farm.farmer.user.name).toBe('Dto Farmer');
      const pub = await expectOk(buyer, 'GET', '/v1/supply?county=Kiambu&limit=100');
      expect(pub.items.find((l: { id: string }) => l.id === listingId).farm.farmer.user.name).toBe('Dto');
      await expectOk(buyer, 'GET', `/v1/supply/${listingId}`);
      await expectOk(farmer, 'PATCH', `/v1/supply/${listingId}`, { notes: 'Fresh from the shamba' });
      const list = await expectOk(buyer, 'GET', '/v1/demand');
      expect(list.items[0]._count).toEqual({ matches: 0, children: 0 });
      const detail = await expectOk(buyer, 'GET', `/v1/demand/${demandId}`);
      expect(detail.upcomingDates).toEqual([]);
      await expectOk(buyer, 'PATCH', `/v1/demand/${demandId}`, { quantity: 25 });
      await expectOk(farmer, 'GET', '/v1/demand/board?county=Nairobi');
      await expectOk(buyer, 'GET', '/v1/matches');
    });

    it('orders, messages and tracking', async () => {
      const buyerOrders = await expectOk(buyer, 'GET', '/v1/orders');
      expect(buyerOrders.items[0].items[0].listing.produce.slug).toBe('kale');
      const farmerOrders = await expectOk(farmer, 'GET', '/v1/orders?status=PENDING');
      expect(farmerOrders.items).toHaveLength(1);
      const detail = await expectOk(buyer, 'GET', `/v1/orders/${orderId}`);
      expect(detail.viewer).toBe('buyer');
      expect(detail.allowedTransitions).toEqual(['CANCELLED']);
      expect(detail).not.toHaveProperty('payout');
      const asFarmer = await expectOk(farmer, 'GET', `/v1/orders/${orderId}`);
      expect(asFarmer.payout).toBeNull();
      await expectOk(
        buyer,
        'POST',
        `/v1/orders/${orderId}/messages`,
        { body: 'Habari, when can you deliver?' },
        201,
      );
      const thread = await expectOk(farmer, 'GET', `/v1/orders/${orderId}/messages`);
      expect(thread[0].author.role).toBe('buyer');
      const tracking = await expectOk(buyer, 'GET', `/v1/orders/${orderId}/tracking`);
      expect(tracking).toMatchObject({ route: null, stops: [], lastLocation: null, deliveryWindow: null });
      await expectOk(farmer, 'POST', `/v1/orders/${orderId}/confirm`);
    });

    it('payments, invoices and payouts', async () => {
      const pay = await expectOk(
        buyer,
        'POST',
        `/v1/orders/${orderId}/pay`,
        { phoneNumber: '0712345678' },
        202,
      );
      const payments = await expectOk(buyer, 'GET', '/v1/payments');
      expect(payments.items[0].id).toBe(pay.paymentId);
      expect(payments.items[0]).not.toHaveProperty('raw');
      const one = await expectOk(buyer, 'GET', `/v1/payments/${pay.paymentId}`);
      expect(one.order.id).toBe(orderId);
      const invoices = await expectOk(buyer, 'GET', '/v1/invoices');
      expect(invoices.items).toEqual([]);
      const payouts = await expectOk(farmer, 'GET', '/v1/payouts');
      expect(payouts.totalPaidCents).toBe(0);
    });

    it('QA, logistics and crates', async () => {
      await expectOk(admin, 'GET', '/v1/qa/tasks');
      const routes = await expectOk(admin, 'GET', '/v1/routes');
      expect(routes).toHaveProperty('nextCursor');
      await expectOk(driver, 'GET', '/v1/routes/today');
      const crates = await expectOk(admin, 'POST', '/v1/crates', { count: 2 }, 201);
      const list = await expectOk(admin, 'GET', '/v1/crates?status=IN_STOCK');
      expect(list.summary.IN_STOCK).toBeGreaterThanOrEqual(2);
      const scanned = await expectOk(admin, 'POST', '/v1/crates/scan', {
        qrCode: crates.qrCodes[0],
        action: 'ISSUE_TO_FARMER',
        toUserId: farmer.userId,
      });
      expect(scanned.status).toBe('WITH_FARMER');
      const detail = await expectOk(admin, 'GET', `/v1/crates/${crates.qrCodes[0]}`);
      expect(detail.movements[0].scannedBy.name).toBe('DTO Admin');
    });

    it('pricing, inputs and notifications', async () => {
      await expectOk(buyer, 'GET', '/v1/prices?weeks=4');
      await expectOk(buyer, 'GET', '/v1/prices/latest');
      await expectOk(buyer, 'GET', '/v1/forecasts');
      const product = await expectOk(
        supplier,
        'POST',
        '/v1/inputs',
        {
          name: 'DTO Compost 50kg',
          category: 'COMPOST',
          unit: 'BAG',
          pricePerUnit: 80000,
          stock: 10,
          county: 'Kiambu',
        },
        201,
      );
      await expectOk(supplier, 'PATCH', `/v1/inputs/${product.id}`, { stock: 12 });
      const browse = await expectOk(farmer, 'GET', '/v1/inputs?category=COMPOST&limit=100');
      expect(browse.items.find((p: { id: string }) => p.id === product.id).supplierOrg.name).toBe(
        'DTO Compost',
      );
      await expectOk(farmer, 'GET', `/v1/inputs/${product.id}`);
      const order = await expectOk(farmer, 'POST', `/v1/inputs/${product.id}/order`, { quantity: 2 }, 201);
      const orders = await expectOk(supplier, 'GET', '/v1/input-orders');
      expect(orders.items[0].id).toBe(order.id);
      await expectOk(supplier, 'POST', `/v1/input-orders/${order.id}/transition`, { to: 'ACCEPTED' });

      await expectOk(farmer, 'GET', '/v1/notifications');
      await expectOk(farmer, 'POST', '/v1/notifications/read', { all: true });
      const prefs = await expectOk(farmer, 'GET', '/v1/notifications/preferences');
      expect(prefs).not.toHaveProperty('updatedAt');
      const saved = await expectOk(farmer, 'PATCH', '/v1/notifications/preferences', {
        quietFrom: 21,
        quietTo: 6,
      });
      expect(saved.updatedAt).toMatch(/T/);
      await expectOk(
        farmer,
        'POST',
        '/v1/devices',
        { token: 'ExponentPushToken[dto-test]', platform: 'android' },
        201,
      );
      await expectOk(farmer, 'DELETE', '/v1/devices/ExponentPushToken[dto-test]');
    });

    it('uploads', async () => {
      const presign = await expectOk(farmer, 'POST', '/v1/uploads/presign', {
        bucket: 'produce-photos',
        contentType: 'image/jpeg',
        size: 1024,
      });
      expect(presign.method).toBe('PUT');
      await expectOk(farmer, 'POST', '/v1/uploads/url', { key: presign.key });
    });

    it('admin', async () => {
      await expectOk(admin, 'GET', '/v1/admin/summary');
      await expectOk(admin, 'GET', '/v1/admin/reports/impact');
      const users = await expectOk(admin, 'GET', '/v1/admin/users?q=DTO');
      expect(users.items.length).toBeGreaterThan(0);
      const user = await expectOk(admin, 'GET', `/v1/admin/users/${buyer.userId}`);
      expect(user.members[0].organization.profile.type).toBe('BUYER');
      await expectOk(admin, 'POST', `/v1/admin/users/${driver.userId}/role`, { role: 'driver' });
      await expectOk(admin, 'GET', '/v1/admin/kyc');
      const orgs = await expectOk(admin, 'GET', '/v1/admin/orgs');
      expect(orgs.items.find((o: { id: string }) => o.id === buyerOrgId)._count.orders).toBe(1);
      await expectOk(admin, 'POST', `/v1/admin/orgs/${buyerOrgId}/verify`, { verified: true });
      await expectOk(admin, 'GET', '/v1/admin/disputes?open=true');
      await expectOk(admin, 'GET', '/v1/admin/payouts');
      const settings = await expectOk(admin, 'GET', '/v1/admin/settings');
      expect(settings.commissionBps).toBe(800);
      const bad = await call(app, admin, 'PUT', '/v1/admin/settings/commissionBps', {
        value: 'eight percent',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('INVALID_SETTING');
      const updated = await expectOk(admin, 'PUT', '/v1/admin/settings/crateReturnDays', { value: 10 });
      expect(updated.crateReturnDays).toBe(10);
      const audit = await expectOk(admin, 'GET', '/v1/admin/audit?entity=PlatformSetting');
      expect(typeof audit.items[0].id).toBe('string');
      await expectOk(admin, 'POST', '/v1/admin/jobs/expire-matches/run', undefined, 202);
    });

    it('health', async () => {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.json()).toEqual({ status: 'ok' });
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect([200, 503]).toContain(ready.statusCode);
      expect(ready.json().checks.database.ok).toBe(true);
    });
  });
});
