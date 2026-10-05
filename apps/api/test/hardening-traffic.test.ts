import { poolConfig } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { call, closeApp, emailUser } from './helpers.js';

/** Release hardening, item 2: pool and timeouts, draining readiness, the session cache. */

describe('database pool', () => {
  it('sets pool size and a statement timeout', () => {
    const c = poolConfig('postgresql://x@db/farmgo', { max: 7, statementTimeoutMs: 12_000 });
    expect(c).toMatchObject({
      max: 7,
      statement_timeout: 12_000,
      connectionString: 'postgresql://x@db/farmgo',
    });
    expect(poolConfig('postgresql://x@db/farmgo', { statementTimeoutMs: 0 })).not.toHaveProperty(
      'statement_timeout',
    );
  });
});

describe('server limits and readiness', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false, docs: false });
    await app.ready();
  });
  afterAll(async () => closeApp(app));

  it('has request and connection timeouts', () => {
    expect(app.server.requestTimeout).toBeGreaterThan(0);
    expect(app.initialConfig.connectionTimeout).toBeGreaterThan(app.initialConfig.keepAliveTimeout ?? 0);
  });

  it('reports draining with 503 once shutdown starts', async () => {
    expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200);
    app.lifecycle.draining = true;
    const r = await app.inject({ url: '/health/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json().status).toBe('draining');
    // Liveness is unaffected: the process is fine, it is just leaving.
    expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
    app.lifecycle.draining = false;
  });
});

describe('session cache', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false, docs: false, sessionCacheSeconds: 30 });
    await app.ready();
  });
  afterAll(async () => closeApp(app));

  const cachedKeys = async () => (await app.redis.keys('sess:c:*')).length;

  it('serves repeat requests from the cache and sees onboarding at once', async () => {
    const u = await emailUser(app, undefined, 'Cache Buyer');
    const before = await cachedKeys();
    expect((await call(app, u, 'GET', '/v1/me')).body.user.role).toBe('user');
    expect(await cachedKeys()).toBe(before + 1);
    await call(app, u, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Cache Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    expect((await call(app, u, 'GET', '/v1/me')).body.user.role).toBe('buyer');
    expect((await call(app, u, 'GET', '/v1/orgs/current')).status).toBe(200);
  });

  it('a ban applies on the very next request', async () => {
    const admin = await emailUser(app, 'admin');
    const u = await emailUser(app, undefined, 'Cache Banned');
    expect((await call(app, u, 'GET', '/v1/me')).status).toBe(200);
    expect((await call(app, u, 'GET', '/v1/me')).status).toBe(200);
    await call(app, admin, 'POST', `/v1/admin/users/${u.userId}/ban`, {
      reason: 'Testing bans',
      banned: true,
    });
    expect((await call(app, u, 'GET', '/v1/me')).status).toBeGreaterThanOrEqual(401);
  });

  it('sign-out applies on the very next request', async () => {
    const u = await emailUser(app, undefined, 'Cache Leaver');
    expect((await call(app, u, 'GET', '/v1/me')).status).toBe(200);
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: u.headers });
    expect(out.statusCode).toBe(200);
    expect((await call(app, u, 'GET', '/v1/me')).status).toBe(401);
  });
});
