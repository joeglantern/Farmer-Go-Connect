import { randomUUID } from 'node:crypto';
import { closeQueues, relayOutboxBatch, routeEvent } from '@farmgo/core';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { syncAuthUser } from '../src/lib/auth-sync.js';
import { OTP_TEST_KEY } from '../src/plugins/auth.js';
import { PRODUCE } from '../src/scripts/catalog.js';

export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'correct-horse-battery';

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false, docs: false });
  await app.ready();
  // Upsert the whole catalog every time: a check like "table is empty" skips seeding whenever
  // another test file has already created a single produce row, leaving later files without it.
  for (const p of PRODUCE) {
    await app.prisma.produce.upsert({ where: { slug: p.slug }, create: p, update: {} });
  }
  return app;
}

export async function closeApp(app: FastifyInstance) {
  await app.close();
  await closeQueues();
}

export interface Session {
  token: string;
  userId: string;
  headers: Record<string, string>;
}

const sessionFor = (token: string, userId: string): Session => ({
  token,
  userId,
  headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
});

/** Sign up with email + password and optionally set the platform role directly. */
export async function emailUser(app: FastifyInstance, role?: string, name = 'Test User'): Promise<Session> {
  const email = `${randomUUID().slice(0, 8)}@test.farmgo`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD, name },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const body = res.json() as { token: string; user: { id: string } };
  if (role) {
    await app.prisma.user.update({ where: { id: body.user.id }, data: { role } });
    await syncAuthUser(app, body.user.id);
  }
  return sessionFor(body.token, body.user.id);
}

/** A random valid Safaricom-style number (+2547 followed by 8 digits). */
export const nextPhone = () => `+2547${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** Phone OTP sign-in (the way farmers log in). The test SMS hook stores the code in Redis. */
export async function phoneUser(app: FastifyInstance, phone: string): Promise<Session> {
  const send = await app.inject({
    method: 'POST',
    url: '/api/auth/phone-number/send-otp',
    headers: { origin: ORIGIN },
    payload: { phoneNumber: phone },
  });
  if (send.statusCode !== 200) throw new Error(`send-otp failed: ${send.statusCode} ${send.body}`);
  const code = await app.redis.get(OTP_TEST_KEY(phone));
  if (!code) throw new Error('OTP not captured');
  const verify = await app.inject({
    method: 'POST',
    url: '/api/auth/phone-number/verify',
    headers: { origin: ORIGIN },
    payload: { phoneNumber: phone, code },
  });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  const body = verify.json() as { token: string; user: { id: string } };
  return sessionFor(body.token, body.user.id);
}

/** Authenticated inject. Returns status and parsed JSON. */
export async function call<T = any>(
  app: FastifyInstance,
  s: Session | null,
  method: InjectOptions['method'],
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.inject({
    method,
    url,
    payload: payload as InjectOptions['payload'],
    headers: { ...(s?.headers ?? {}), ...headers },
  });
  let json: T;
  try {
    json = res.json() as T;
  } catch {
    json = res.body as unknown as T;
  }
  return { status: res.statusCode, body: json, raw: res };
}

/** Relay every pending outbox event (what the worker does continuously). */
export async function drainOutbox(app: FastifyInstance) {
  let n: number;
  do {
    n = await relayOutboxBatch(app.prisma, (row) => routeEvent(app.prisma, app.redis, row));
  } while (n > 0);
}

export const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export async function produceId(app: FastifyInstance, slug: string) {
  return (await app.prisma.produce.findUniqueOrThrow({ where: { slug } })).id;
}
