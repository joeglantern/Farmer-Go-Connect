import { env, isTest } from '@farmgo/config';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Routes that move money or start a payment. While Redis (and so the rate limiter) is down they
 * refuse with 503 instead of running unlimited, and an admin impersonating a user cannot call them.
 */
export const MONEY_ROUTES = new Set([
  'POST /v1/checkout',
  'POST /v1/checkouts/:id/pay',
  'POST /v1/orders/:id/pay',
  'POST /v1/orders/:id/cancel',
  'POST /v1/invoices/:id/pay',
  'POST /v1/input-orders/:id/pay',
  'POST /v1/admin/payments/manual',
  'POST /v1/admin/payouts/:orderId/retry',
  'POST /v1/admin/disputes/:id/resolve',
]);

const routeKey = (req: FastifyRequest) => `${req.method} ${req.routeOptions.url ?? ''}`;
const isAuthRoute = (req: FastifyRequest) => req.routeOptions.url === '/api/auth/*';

function refuse(reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message, requestId: req.id } });
}

/** CORS allow-list, security headers, form bodies (USSD/webhooks) and Redis-backed rate limits. */
export default fp(
  async (app) => {
    const origins = new Set([env.WEB_URL, env.ADMIN_URL, ...env.CORS_ORIGINS]);
    await app.register(cors, {
      origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Org-Id'],
      exposedHeaders: ['set-auth-token', 'X-Request-Id'],
    });
    await app.register(helmet, {
      // The API docs page loads its UI from a CDN.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });
    await app.register(formbody);
    await app.register(rateLimit, {
      global: !isTest,
      max: 300,
      timeWindow: '1 minute',
      redis: app.redis,
      nameSpace: 'rl:',
      keyGenerator: (req) => req.user?.id ?? req.ip,
      // Other routes stay up if Redis blips; auth and money routes fail closed below.
      skipOnError: true,
    });
    // Whether the rate limiter's store can be used right now (replaceable in tests).
    app.decorate('rateLimitStoreReady', () => app.redis.status === 'ready');
    app.addHook('onRequest', async (req, reply) => {
      const money = MONEY_ROUTES.has(routeKey(req));
      if ((money || isAuthRoute(req)) && !app.rateLimitStoreReady()) {
        return refuse(
          reply,
          req,
          503,
          'RATE_LIMIT_UNAVAILABLE',
          'This is paused for a moment while we reconnect. Try again shortly.',
        );
      }
      if (money && (req.session as { impersonatedBy?: string | null } | null)?.impersonatedBy) {
        return refuse(
          reply,
          req,
          403,
          'IMPERSONATION_READ_ONLY',
          'Payments, refunds and payouts are not available while viewing as another user',
        );
      }
    });
    app.addHook('onSend', async (req, reply) => {
      reply.header('X-Request-Id', req.id);
    });
  },
  { name: 'security', dependencies: ['infra'] },
);
