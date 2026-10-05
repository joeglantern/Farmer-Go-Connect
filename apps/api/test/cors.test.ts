import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, emailUser, makeApp, PASSWORD } from './helpers.js';

const EXPO_WEB = 'http://localhost:8081';

/** QA-020: the Expo web app (port 8081) can call the API and sign in. */
describe('browser origins', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => closeApp(app));

  it('answers the CORS preflight for the Expo web origin', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: { origin: EXPO_WEB, 'access-control-request-method': 'GET' },
    });
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(EXPO_WEB);
  });

  it('refuses unknown origins', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lets the Expo web origin sign in (Better Auth trusted origins)', async () => {
    const u = await emailUser(app, undefined, 'Web User');
    const email = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).email;
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: EXPO_WEB },
      payload: { email, password: PASSWORD },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().token).toBeTruthy();
  });

  it('lets the native app sign in: a cookie, no Origin, and expo-origin: farmgo://', async () => {
    const u = await emailUser(app, undefined, 'Native User');
    const email = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).email;
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      // What React Native sends: no Origin header, a stale cookie from an earlier session.
      headers: { 'expo-origin': 'farmgo://', cookie: 'farmgo.session_token=stale' },
      payload: { email, password: PASSWORD },
    });
    expect(r.statusCode).toBe(200);
    const token = r.json().token as string;
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().impersonatedBy).toBeNull();
  });
});
