import type { AddressInfo } from 'node:net';
import { parseEnvFrom, productionProblems } from '@farmgo/config';
import { redactUrl } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { docsEnabledFor } from '../src/app.js';
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

/** Release hardening, item 1: configuration, logs, webhooks, sockets, guards. */

const BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x@db/farmgo',
  REDIS_URL: 'redis://redis:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  BETTER_AUTH_URL: 'https://api.example.test',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
};

const SAFE = {
  ...BASE,
  MPESA_PROVIDER: 'daraja',
  MPESA_CALLBACK_TOKEN: 'b'.repeat(32),
  AT_USSD_TOKEN: 'c'.repeat(32),
  AT_DLR_TOKEN: 'd'.repeat(32),
  METRICS_TOKEN: 'e'.repeat(32),
  CARD_PROVIDER: 'pesapal',
  PESAPAL_CONSUMER_KEY: 'key',
  PESAPAL_CONSUMER_SECRET: 'f'.repeat(32),
  PESAPAL_IPN_ID: 'ipn',
};

describe('production configuration', () => {
  it('accepts a complete production configuration', () => {
    expect(productionProblems(parseEnvFrom(SAFE))).toEqual([]);
  });

  it('refuses development secrets and missing tokens', () => {
    const problems = productionProblems(
      parseEnvFrom({ ...SAFE, MPESA_CALLBACK_TOKEN: 'dev-callback-token' }),
    );
    expect(problems.join(' ')).toMatch(/MPESA_CALLBACK_TOKEN/);
    expect(productionProblems(parseEnvFrom({ ...SAFE, METRICS_TOKEN: '' })).join(' ')).toMatch(
      /METRICS_TOKEN/,
    );
    expect(productionProblems(parseEnvFrom({ ...SAFE, PESAPAL_CONSUMER_SECRET: '' })).join(' ')).toMatch(
      /PESAPAL_CONSUMER_SECRET/,
    );
    expect(productionProblems(parseEnvFrom({ ...SAFE, AT_DLR_TOKEN: undefined })).join(' ')).toMatch(
      /AT_DLR_TOKEN/,
    );
  });

  it('allows mock payment providers only when explicitly enabled for a tester stack', () => {
    const mock = { ...SAFE, MPESA_PROVIDER: 'mock', CARD_PROVIDER: 'mock' };
    expect(productionProblems(parseEnvFrom(mock)).join(' ')).toMatch(/MPESA_PROVIDER=mock/);
    // The allow switch alone is not enough: it must be a declared tester stack.
    const alone = productionProblems(parseEnvFrom({ ...mock, ALLOW_MOCK_PROVIDERS: 'true' })).join(' ');
    expect(alone).toMatch(/TESTER_STACK/);
    expect(
      productionProblems(parseEnvFrom({ ...mock, ALLOW_MOCK_PROVIDERS: 'true', TESTER_STACK: 'true' })),
    ).toEqual([]);
  });

  it('serves /docs in production only with DOCS_PUBLIC', () => {
    expect(docsEnabledFor({ NODE_ENV: 'development', DOCS_PUBLIC: false })).toBe(true);
    expect(docsEnabledFor({ NODE_ENV: 'production', DOCS_PUBLIC: false })).toBe(false);
    expect(docsEnabledFor({ NODE_ENV: 'production', DOCS_PUBLIC: true })).toBe(true);
  });
});

describe('log redaction', () => {
  it('removes secrets from logged URLs and keeps everything else', () => {
    expect(redactUrl('/webhooks/mpesa/stk?token=abc123')).toBe('/webhooks/mpesa/stk?token=[redacted]');
    expect(redactUrl('/ws?token=t0k&x=1')).toBe('/ws?token=[redacted]&x=1');
    expect(redactUrl('/v1/supply?q=kale&sort=nearest')).toBe('/v1/supply?q=kale&sort=nearest');
    expect(redactUrl('/health/live')).toBe('/health/live');
    expect(redactUrl('/cb?OTP=1234&Code=9')).toBe('/cb?OTP=[redacted]&Code=[redacted]');
  });
});

describe('hardened routes', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let other: Session;
  let listingId: string;
  let orderId: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Hardening Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Hardening Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Hardening Farmer',
      county: 'Nakuru',
      farm: { name: 'Hardening Farm', county: 'Nakuru' },
    });
    other = await phoneUser(app, nextPhone());
    await call(app, other, 'POST', '/v1/onboarding/farmer', { name: 'Other Farmer', county: 'Nakuru' });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'sweet-potatoes'),
        quantity: 100,
        pricePerUnit: 5000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
    orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body.id;
  });
  afterAll(async () => closeApp(app));

  it('SMS delivery reports need the delivery report token', async () => {
    const report = { id: 'ATXid_1', status: 'Failed', failureReason: 'UserInBlacklist' };
    const without = await app.inject({
      method: 'POST',
      url: '/webhooks/sms/delivery-report',
      payload: report,
    });
    expect(without.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'POST',
      url: '/webhooks/sms/delivery-report?token=nope',
      payload: {},
    });
    expect(wrong.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/webhooks/sms/delivery-report?token=dev-dlr-token',
      payload: report,
    });
    expect(ok.statusCode).toBe(200);
  });

  it('undoing harvest-ready checks who is asking before looking the listing up', async () => {
    const url = `/v1/supply/${listingId}/harvest-ready`;
    expect((await call(app, null, 'DELETE', url)).status).toBe(401);
    expect((await call(app, buyer, 'DELETE', url)).status).toBe(403);
    expect((await call(app, buyer, 'DELETE', '/v1/supply/does-not-exist/harvest-ready')).status).toBe(403);
    // Another farmer cannot tell a listing that is not theirs from one that does not exist.
    const notMine = await call(app, other, 'DELETE', url);
    const missing = await call(app, other, 'DELETE', '/v1/supply/does-not-exist/harvest-ready');
    expect(notMine.status).toBe(404);
    expect(notMine.body.error.message).toBe(missing.body.error.message);
    expect((await call(app, farmer, 'DELETE', url)).status).toBe(200);
  });

  it('money routes fail closed while the rate limiter store is down', async () => {
    const real = app.rateLimitStoreReady;
    app.rateLimitStoreReady = () => false;
    try {
      const pay = await call(app, buyer, 'POST', `/v1/orders/${orderId}/pay`, { phoneNumber: '0712345678' });
      expect(pay.status).toBe(503);
      expect(pay.body.error.code).toBe('RATE_LIMIT_UNAVAILABLE');
      const signIn = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email: 'x@example.test', password: 'whatever-123' },
      });
      expect(signIn.statusCode).toBe(503);
      // Reading stays available.
      expect((await call(app, buyer, 'GET', `/v1/orders/${orderId}`)).status).toBe(200);
    } finally {
      app.rateLimitStoreReady = real;
    }
  });

  it('an admin viewing as a user cannot pay, refund or move payouts', async () => {
    const admin = await emailUser(app, 'admin');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/impersonate-user',
      headers: admin.headers,
      payload: { userId: buyer.userId },
    });
    expect(r.statusCode).toBe(200);
    const token = (r.headers['set-auth-token'] as string | undefined) ?? r.json().session?.token;
    expect(token).toBeTruthy();
    const asBuyer: Session = {
      token,
      userId: buyer.userId,
      headers: { ...admin.headers, authorization: `Bearer ${token}` },
    };
    const me = await call(app, asBuyer, 'GET', '/v1/me');
    expect(me.body.impersonatedBy).toBe(admin.userId);
    const pay = await call(app, asBuyer, 'POST', `/v1/orders/${orderId}/pay`, { phoneNumber: '0712345678' });
    expect(pay.status).toBe(403);
    expect(pay.body.error.code).toBe('IMPERSONATION_READ_ONLY');
    // Looking around is still fine.
    expect((await call(app, asBuyer, 'GET', `/v1/orders/${orderId}`)).status).toBe(200);
  });

  it('the WebSocket accepts the token as a subprotocol, header or query', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const hello = (ws: WebSocket) =>
      new Promise<any>((resolve, reject) => {
        ws.on('message', (m) => {
          const msg = JSON.parse(m.toString());
          if (msg.op === 'hello') resolve(msg);
        });
        ws.on('close', (code) => reject(new Error(`closed ${code}`)));
      });

    const viaProtocol = new WebSocket(`ws://127.0.0.1:${port}/ws`, [
      'farmgo.bearer',
      encodeURIComponent(buyer.token),
    ]);
    expect((await hello(viaProtocol)).userId).toBe(buyer.userId);
    expect(viaProtocol.protocol).toBe('farmgo.bearer');
    viaProtocol.close();

    const viaHeader = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect((await hello(viaHeader)).userId).toBe(buyer.userId);
    viaHeader.close();

    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['farmgo.bearer', 'not-a-token']);
    const code = await new Promise<number>((resolve) => bad.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });
});
