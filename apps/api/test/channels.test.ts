import type { AddressInfo } from 'node:net';
import { checkStkStatus, expandRecurringDemand } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  call,
  closeApp,
  days,
  drainOutbox,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

const ussd = (app: FastifyInstance, phoneNumber: string, text: string, sessionId = 's1') =>
  app
    .inject({
      method: 'POST',
      url: '/webhooks/ussd?token=test-ussd-token',
      payload: { sessionId, phoneNumber, text, serviceCode: '*384*123#' },
    })
    .then((r) => r.body);

describe('other channels and features', () => {
  let app: FastifyInstance;
  let admin: Session;
  let buyer: Session;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    buyer = await emailUser(app);
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'WS Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
  });
  afterAll(async () => closeApp(app));

  describe('USSD for feature phones', () => {
    const phone = nextPhone();

    it('registers a new farmer in Kiswahili', async () => {
      expect(await ussd(app, phone, '')).toMatch(/^CON Karibu FarmGo/);
      expect(await ussd(app, phone, '1')).toBe('CON Andika jina lako kamili:');
      expect(await ussd(app, phone, '1*Amina Hassan')).toMatch(/kaunti/i);
      expect(await ussd(app, phone, '1*Amina Hassan*Nowhere')).toMatch(/^END Kaunti haikupatikana/);
      expect(await ussd(app, phone, '1*Amina Hassan*kiambu')).toMatch(/^END Umesajiliwa/);
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { phoneNumber: phone },
        include: { farmerProfile: true },
      });
      expect(user.role).toBe('farmer');
      expect(user.county).toBe('Kiambu');
      expect(user.farmerProfile?.mpesaNumber).toBe(phone);
    });

    it('lists produce from the phone menu once a farm exists', async () => {
      expect(await ussd(app, phone, '1', 'sell-0')).toMatch(/^END Huna shamba/);
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { phoneNumber: phone },
        include: { farmerProfile: true },
      });
      await app.prisma.farm.create({
        data: { farmerId: user.farmerProfile!.id, name: 'Amina Shamba', county: 'Kiambu' },
      });
      expect(await ussd(app, phone, '', 'sell')).toMatch(/1\. Uza mazao/);
      expect(await ussd(app, phone, '1', 'sell')).toMatch(/Chagua zao:\n1\. /);
      expect(await ussd(app, phone, '1*1', 'sell')).toMatch(/Kiasi/);
      expect(await ussd(app, phone, '1*1*50', 'sell')).toMatch(/tayari lini/);
      expect(await ussd(app, phone, '1*1*50*2', 'sell')).toMatch(/Bei kwa/);
      expect(await ussd(app, phone, '1*1*50*2*20', 'sell')).toMatch(/1\. Thibitisha/);
      expect(await ussd(app, phone, '1*1*50*2*20*1', 'sell')).toMatch(/^END Mazao yameorodheshwa/);
      const listing = await app.prisma.supplyListing.findFirstOrThrow({
        where: { farm: { farmer: { userId: user.id } } },
      });
      expect(Number(listing.quantity)).toBe(50);
      expect(listing.pricePerUnit).toBe(2000);
    });

    it('switches to English', async () => {
      expect(await ussd(app, phone, '9', 'lang')).toMatch(/English/);
      expect(await ussd(app, phone, '', 'lang2')).toMatch(/1\. Sell produce/);
    });
  });

  describe('realtime WebSocket', () => {
    it('authenticates, enforces channel access and delivers order events', async () => {
      const farmer = await phoneUser(app, nextPhone());
      await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
        name: 'Ws Farmer',
        county: 'Kiambu',
        farm: { name: 'WS Farm', county: 'Kiambu' },
      });
      const farm = (await call(app, farmer, 'GET', '/v1/farms')).body[0];
      const listing = (
        await call(app, farmer, 'POST', '/v1/supply', {
          farmId: farm.id,
          produceId: await produceId(app, 'onions-red'),
          quantity: 100,
          pricePerUnit: 9000,
          availableFrom: days(0),
          availableTo: days(5),
        })
      ).body;
      const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId: listing.id, quantity: 10 }))
        .body;
      await drainOutbox(app);

      await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as AddressInfo).port;

      const rejected = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const code = await new Promise<number>((resolve) => rejected.on('close', (c) => resolve(c)));
      expect(code).toBe(4401);

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${buyer.token}`);
      const messages: any[] = [];
      ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
      const waitFor = async (pred: (m: any) => boolean, ms = 5000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          const hit = messages.find(pred);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`timed out; got ${JSON.stringify(messages)}`);
      };

      const hello = await waitFor((m) => m.op === 'hello');
      expect(hello.channels.some((c: string) => c.startsWith('org:'))).toBe(true);

      ws.send(JSON.stringify({ op: 'subscribe', channel: `user:${farmer.userId}` }));
      expect((await waitFor((m) => m.op === 'error')).code).toBe('FORBIDDEN_CHANNEL');

      ws.send(JSON.stringify({ op: 'subscribe', channel: `order:${order.id}`, lastSeq: 0 }));
      await waitFor((m) => m.op === 'subscribed');
      // Catch-up: the order.created event was published before we subscribed.
      await waitFor(
        (m) => m.op === 'event' && m.type === 'order.created' && m.channel === `order:${order.id}`,
      );

      await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
      await drainOutbox(app);
      const evt = await waitFor(
        (m) => m.op === 'event' && m.type === 'order.status_changed' && m.data.to === 'CONFIRMED',
      );
      expect(evt.channel).toMatch(/^(order|org):/);
      expect(evt.seq).toBeGreaterThan(0);

      ws.send(JSON.stringify({ op: 'ping' }));
      await waitFor((m) => m.op === 'pong');
      ws.send('not json');
      expect((await waitFor((m) => m.op === 'error' && m.code === 'BAD_MESSAGE')).code).toBe('BAD_MESSAGE');
      ws.close();

      // QA-033: a subscribe sent the instant the socket opens (before `hello`) is not dropped.
      const eager = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${buyer.token}`);
      const got: any[] = [];
      eager.on('message', (m) => got.push(JSON.parse(m.toString())));
      eager.on('open', () => {
        eager.send(JSON.stringify({ op: 'subscribe', channel: `order:${order.id}` }));
        eager.send(JSON.stringify({ op: 'ping' }));
      });
      const until = async (pred: (m: any) => boolean) => {
        const start = Date.now();
        while (Date.now() - start < 5000) {
          if (got.some(pred)) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`timed out; got ${JSON.stringify(got)}`);
      };
      await until((m) => m.op === 'pong');
      const ops = got.map((m) => m.op);
      // Handled in order, after the connection was ready.
      expect(ops.indexOf('hello')).toBeLessThan(ops.indexOf('subscribed'));
      expect(ops.indexOf('subscribed')).toBeLessThan(ops.indexOf('pong'));
      await call(app, buyer, 'POST', `/v1/orders/${order.id}/messages`, { body: 'Early bird' });
      await drainOutbox(app);
      await until((m) => m.op === 'event' && m.type === 'order.message' && m.channel === `order:${order.id}`);
      eager.close();
    });
  });

  describe('field agents', () => {
    it('registers a farmer without a smartphone and lists for them', async () => {
      const agent = await emailUser(app, 'agent');
      const phone = nextPhone();
      const created = await call(app, agent, 'POST', '/v1/agent/farmers', {
        phoneNumber: phone.replace('+254', '0'),
        name: 'Wanjiku Njeri',
        county: 'Nyeri',
        gender: 'FEMALE',
        farm: { name: 'Njeri Farm', county: 'Nyeri' },
      });
      expect(created.status).toBe(201);
      expect(created.body.user.phoneNumber).toBe(phone);
      const dup = await call(app, agent, 'POST', '/v1/agent/farmers', {
        phoneNumber: phone,
        name: 'Again',
        county: 'Nyeri',
      });
      expect(dup.status).toBe(409);
      const mine = await call(app, agent, 'GET', '/v1/agent/farmers');
      const fp = mine.body.items.find((f: { user: { phoneNumber: string } }) => f.user.phoneNumber === phone);
      const listing = await call(app, agent, 'POST', '/v1/supply', {
        farmId: fp.farms[0].id,
        produceId: await produceId(app, 'cabbage'),
        quantity: 200,
        pricePerUnit: 3500,
        availableFrom: days(1),
        availableTo: days(6),
      });
      expect(listing.status).toBe(201);
      const otherAgent = await emailUser(app, 'agent');
      const denied = await call(app, otherAgent, 'POST', '/v1/supply', {
        farmId: fp.farms[0].id,
        produceId: await produceId(app, 'cabbage'),
        quantity: 1,
        pricePerUnit: 1,
        availableFrom: days(1),
        availableTo: days(2),
      });
      expect(denied.status).toBe(404);
      // The farmer can later sign in with their phone and sees the same account.
      const farmer = await phoneUser(app, phone);
      expect((await call(app, farmer, 'GET', '/v1/me')).body.user.name).toBe('Wanjiku Njeri');
    });
  });

  describe('recurring demand', () => {
    it('expands a weekly requirement into dated instances, once', async () => {
      const monday = new Date();
      monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
      const res = await call(app, buyer, 'POST', '/v1/demand', {
        produceId: await produceId(app, 'kale'),
        quantity: 40,
        neededBy: monday.toISOString(),
        recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      });
      expect(res.status).toBe(201);
      const children = await app.prisma.demandRequest.count({ where: { parentId: res.body.id } });
      expect(children).toBeGreaterThanOrEqual(2);
      await expandRecurringDemand(app.prisma);
      expect(await app.prisma.demandRequest.count({ where: { parentId: res.body.id } })).toBe(children);
      const detail = await call(app, buyer, 'GET', `/v1/demand/${res.body.id}`);
      expect(detail.body.upcomingDates.length).toBeGreaterThan(0);
      const cancel = await call(app, buyer, 'PATCH', `/v1/demand/${res.body.id}`, { status: 'CANCELLED' });
      expect(cancel.body.status).toBe('CANCELLED');
      expect(await app.prisma.demandRequest.count({ where: { parentId: res.body.id, status: 'OPEN' } })).toBe(
        0,
      );
    });

    it('rejects an unreadable recurrence rule', async () => {
      const res = await call(app, buyer, 'POST', '/v1/demand', {
        produceId: await produceId(app, 'kale'),
        quantity: 40,
        neededBy: days(3),
        recurrence: 'every tuesday',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('green inputs marketplace', () => {
    it('lets a youth enterprise sell compost to a farmer with stock control', async () => {
      const supplier = await emailUser(app);
      await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
        businessName: 'Kijani Compost',
        county: 'Kiambu',
      });
      const product = await call(app, supplier, 'POST', '/v1/inputs', {
        name: 'Vermicompost 50kg',
        category: 'COMPOST',
        unit: 'BAG',
        pricePerUnit: 150_000,
        stock: 5,
        county: 'Kiambu',
      });
      expect(product.status).toBe(201);
      const farmer = await phoneUser(app, nextPhone());
      await call(app, farmer, 'POST', '/v1/onboarding/farmer', { name: 'Input Buyer', county: 'Kiambu' });
      const tooMany = await call(app, farmer, 'POST', `/v1/inputs/${product.body.id}/order`, { quantity: 6 });
      expect(tooMany.body.error.code).toBe('OUT_OF_STOCK');
      const order = await call(app, farmer, 'POST', `/v1/inputs/${product.body.id}/order`, { quantity: 2 });
      expect(order.body.total).toBe(300_000);
      // Paid by M-Pesa on ordering (QA-024); the supplier can dispatch once it is paid.
      expect(order.body.payment.status).toBe('PENDING');
      await checkStkStatus(app.prisma, order.body.payment.paymentId);
      const buyerSkip = await call(app, farmer, 'POST', `/v1/input-orders/${order.body.id}/transition`, {
        to: 'ACCEPTED',
      });
      expect(buyerSkip.status).toBe(409);
      for (const to of ['ACCEPTED', 'DISPATCHED']) {
        expect(
          (await call(app, supplier, 'POST', `/v1/input-orders/${order.body.id}/transition`, { to })).status,
        ).toBe(200);
      }
      expect(
        (await call(app, farmer, 'POST', `/v1/input-orders/${order.body.id}/transition`, { to: 'DELIVERED' }))
          .body.status,
      ).toBe('DELIVERED');
      expect(
        Number((await app.prisma.inputProduct.findUniqueOrThrow({ where: { id: product.body.id } })).stock),
      ).toBe(3);
    });
  });

  describe('crates, uploads, settings and health', () => {
    it('refuses impossible crate moves', async () => {
      const { qrCodes } = (await call(app, admin, 'POST', '/v1/crates', { count: 1 })).body;
      const r = await call(app, admin, 'POST', '/v1/crates/scan', {
        qrCode: qrCodes[0],
        action: 'DELIVER_TO_BUYER',
      });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CRATE_INVALID_SCAN');
      const history = await call(app, admin, 'GET', `/v1/crates/${qrCodes[0]}`);
      expect(history.body.status).toBe('IN_STOCK');
    });

    it('issues upload URLs scoped to the caller', async () => {
      const r = await call(app, buyer, 'POST', '/v1/uploads/presign', {
        bucket: 'chat',
        contentType: 'image/jpeg',
        size: 200_000,
      });
      expect(r.status).toBe(200);
      expect(r.body.key).toMatch(new RegExp(`^chat/${buyer.userId}/.+\\.jpg$`));
      expect(r.body.url).toContain('X-Amz-Signature');
      const qa = await call(app, buyer, 'POST', '/v1/uploads/presign', {
        bucket: 'qa-evidence',
        contentType: 'image/jpeg',
        size: 1000,
      });
      expect(qa.status).toBe(403);
      const huge = await call(app, buyer, 'POST', '/v1/uploads/presign', {
        bucket: 'chat',
        contentType: 'image/jpeg',
        size: 50_000_000,
      });
      expect(huge.status).toBe(400);
    });

    it('lets admins tune business settings', async () => {
      const r = await call(app, admin, 'PUT', '/v1/admin/settings/commissionBps', { value: 700 });
      expect(r.body.commissionBps).toBe(700);
      expect((await call(app, admin, 'PUT', '/v1/admin/settings/notARealSetting', { value: 1 })).status).toBe(
        404,
      );
      await call(app, admin, 'PUT', '/v1/admin/settings/commissionBps', { value: 800 });
      const audit = await call(app, admin, 'GET', '/v1/admin/audit?entity=PlatformSetting');
      expect(audit.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('reports health', async () => {
      const r = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(r.json().checks.database.ok).toBe(true);
      expect(r.json().checks.redis.ok).toBe(true);
    });

    it('exposes Prometheus metrics', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('farmgo_http_request_duration_seconds');
      expect(r.body).toContain('farmgo_queue_jobs');
      expect(r.body).toContain('farmgo_outbox_pending');
    });
  });
});
