import { createAuth } from '@farmgo/auth';
import { env, isTest } from '@farmgo/config';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { enqueue, logger, redisKeyValue, render } from '@farmgo/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { bumpUser, credentialHash, currentGen, readSession, writeSession } from '../lib/session-cache.js';

const EMAIL_COPY = {
  'verify-email': (d: Record<string, string>) => ({
    subject: 'Confirm your FarmGo email',
    text: `Hi ${d.name}, confirm your email: ${d.url}`,
  }),
  'reset-password': (d: Record<string, string>) => ({
    subject: 'Reset your FarmGo password',
    text: `Hi ${d.name}, reset your password here: ${d.url}. If you did not ask for this, ignore this email.`,
  }),
  'org-invite': (d: Record<string, string>) => ({
    subject: `${d.inviter} invited you to ${d.organization} on FarmGo`,
    text: `${d.inviter} invited you to join ${d.organization} on FarmGo Connect. Accept here: ${d.url}`,
  }),
};

export const OTP_TEST_KEY = (phone: string) => `test:otp:${phone}`;

/**
 * Better Auth mounted at /api/auth/*, plus a hook that resolves the session (cookie or
 * bearer token) for every other request into `req.user` / `req.session`.
 */
export default fp(
  async (app) => {
    const auth = createAuth({
      prisma: app.prisma,
      secondaryStorage: redisKeyValue(app.redis),
      onUserChanged: (userId) => bumpUser(app.redis, userId).catch(() => undefined),
      sendOtp: async (phoneNumber, code, purpose) => {
        if (isTest) await app.redis.set(OTP_TEST_KEY(phoneNumber), code, 'EX', 300);
        if (env.NODE_ENV === 'development') logger.info({ phoneNumber, code, purpose }, 'OTP (dev only)');
        const { sms } = render('otp', 'sw', { code });
        await enqueue('notify', 'sms', { to: phoneNumber, message: sms, kind: 'otp' }, { attempts: 3 });
      },
      sendEmail: async (to, template, data) => {
        const { subject, text } = EMAIL_COPY[template](data);
        await enqueue('notify', 'email', { to, subject, text, html: `<p>${text}</p>` });
      },
    });
    app.decorate('auth', auth);
    app.decorateRequest('user', null);
    app.decorateRequest('session', null);

    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      schema: { hide: true },
      config: { rateLimit: false },
      async handler(req, reply) {
        const url = new URL(req.url, env.BETTER_AUTH_URL);
        const headers = fromNodeHeaders(req.headers);
        // Phone sign-in accepts the same formats as the rest of the API: normalise to +2547...
        // before Better Auth sees it, so "0711000001" and "+254711000001" are the same account.
        if (
          url.pathname.includes('/phone-number/') &&
          req.body &&
          typeof req.body === 'object' &&
          typeof (req.body as { phoneNumber?: unknown }).phoneNumber === 'string'
        ) {
          const b = req.body as { phoneNumber: string };
          b.phoneNumber = normalizeKenyanPhone(b.phoneNumber) ?? b.phoneNumber;
        }
        const body =
          req.method === 'GET' || req.body === undefined
            ? undefined
            : typeof req.body === 'string'
              ? req.body
              : JSON.stringify(req.body);
        const res = await auth.handler(new Request(url, { method: req.method, headers, body }));
        await invalidateAfterAuthCall(app.redis, req, url.pathname);
        reply.status(res.status);
        res.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
        });
        const cookies = res.headers.getSetCookie?.() ?? [];
        if (cookies.length) reply.header('set-cookie', cookies);
        const text = await res.text();
        return reply.send(text.length ? text : null);
      },
    });

    app.addHook('onRequest', async (req) => {
      if (req.url.startsWith('/api/auth/') || req.url.startsWith('/health')) return;
      await loadSession(app.auth, req);
    });
    // A user who changes something (onboarding, profile, deletion) sees it on their next request.
    // onSend runs before the reply leaves, so the client cannot race ahead of the invalidation.
    app.addHook('onSend', async (req, _reply, payload) => {
      if (req.user && req.method !== 'GET' && req.method !== 'HEAD' && app.sessionCacheSeconds > 0)
        await bumpUser(app.redis, req.user.id).catch(() => undefined);
      return payload;
    });
  },
  { name: 'auth', dependencies: ['infra'] },
);

/**
 * Sign-out, session revocation and admin user actions change who is signed in: drop the cache for
 * the caller and for the user an admin acted on.
 */
async function invalidateAfterAuthCall(redis: Redis, req: FastifyRequest, path: string) {
  if (!/sign-out|revoke|\/admin\/|impersonat|update-user|change-|set-active|delete-user/.test(path)) return;
  const ids = new Set<string>();
  const hash = credentialHash(req);
  if (hash) {
    const cached = await readSession(redis, hash).catch(() => null);
    if (cached) ids.add(cached.user.id);
  }
  const target = (req.body as { userId?: unknown } | undefined)?.userId;
  if (typeof target === 'string') ids.add(target);
  for (const id of ids) await bumpUser(redis, id).catch(() => undefined);
}

export async function loadSession(auth: ReturnType<typeof createAuth>, req: FastifyRequest) {
  const hasCredentials = !!req.headers.authorization || !!req.headers.cookie;
  if (!hasCredentials) return;
  const ttl = req.server.sessionCacheSeconds;
  const hash = ttl > 0 ? credentialHash(req) : null;
  if (hash) {
    const cached = await readSession(req.server.redis, hash).catch(() => null);
    if (cached) {
      req.user = cached.user;
      req.session = cached.session;
      return;
    }
  }
  try {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (result) {
      // Role, ban and profile fields can change outside Better Auth (onboarding, admin tools),
      // so read the current row rather than trusting the cached session copy.
      const gen = hash ? await currentGen(req.server.redis, result.user.id).catch(() => null) : null;
      const fresh = await req.server.prisma.user.findUnique({ where: { id: result.user.id } });
      if (!fresh) return;
      req.user = { ...result.user, ...fresh } as typeof req.user;
      req.session = result.session as typeof req.session;
      if (hash && gen !== null && req.user && req.session)
        await writeSession(req.server.redis, hash, { gen, user: req.user, session: req.session }, ttl).catch(
          () => undefined,
        );
    }
  } catch (err) {
    req.log.warn({ err }, 'session lookup failed');
  }
}
