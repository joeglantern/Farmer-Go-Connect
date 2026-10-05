import { randomUUID } from 'node:crypto';
import { type Env, env } from '@farmgo/config';
import { loggerOptions } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import addressRoutes from './modules/addresses.routes.js';
import adminRoutes from './modules/admin.routes.js';
import adminDetailRoutes from './modules/admin-detail.routes.js';
import agentRoutes from './modules/agent.routes.js';
import catalogRoutes from './modules/catalog.routes.js';
import checkoutRoutes from './modules/checkout.routes.js';
import conversationRoutes from './modules/conversations.routes.js';
import crateRoutes from './modules/crates.routes.js';
import dashboardRoutes from './modules/dashboard.routes.js';
import demandRoutes from './modules/demand.routes.js';
import farmerRoutes from './modules/farmers.routes.js';
import farmRoutes from './modules/farms.routes.js';
import favoriteRoutes from './modules/favorites.routes.js';
import healthRoutes from './modules/health.routes.js';
import inputRoutes from './modules/inputs.routes.js';
import logisticsRoutes from './modules/logistics.routes.js';
import matchRoutes from './modules/matches.routes.js';
import meRoutes from './modules/me.routes.js';
import notificationRoutes from './modules/notifications.routes.js';
import orderRoutes from './modules/orders.routes.js';
import paymentRoutes from './modules/payments.routes.js';
import pricingRoutes from './modules/pricing.routes.js';
import qaRoutes from './modules/qa.routes.js';
import staffRoutes from './modules/staff.routes.js';
import supplyRoutes from './modules/supply.routes.js';
import uploadRoutes from './modules/uploads.routes.js';
import webhookRoutes from './modules/webhooks.routes.js';
import authPlugin from './plugins/auth.js';
import docsPlugin from './plugins/docs.js';
import errorsPlugin from './plugins/errors.js';
import idempotencyPlugin from './plugins/idempotency.js';
import infraPlugin from './plugins/infra.js';
import metricsPlugin from './plugins/metrics.js';
import queueBoardPlugin from './plugins/queue-board.js';
import securityPlugin from './plugins/security.js';
import serializePlugin from './plugins/serialize.js';
import realtimeGateway from './realtime/gateway.js';
import './types.js';

export interface BuildOptions {
  prisma?: PrismaClient;
  redis?: Redis;
  logger?: boolean;
  docs?: boolean;
  /** Override SESSION_CACHE_SECONDS (tests). */
  sessionCacheSeconds?: number;
}

/** The API reference is public in development; production serves it only with DOCS_PUBLIC=true. */
export const docsEnabledFor = (e: Pick<Env, 'NODE_ENV' | 'DOCS_PUBLIC'>) =>
  e.NODE_ENV !== 'production' || e.DOCS_PUBLIC;

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : env.NODE_ENV === 'development'
          ? {
              ...loggerOptions,
              transport: {
                target: 'pino-pretty',
                options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
              },
            }
          : loggerOptions,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID(),
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestTimeout: env.HTTP_REQUEST_TIMEOUT_MS,
    connectionTimeout: env.HTTP_CONNECTION_TIMEOUT_MS,
    keepAliveTimeout: env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
  });

  app.decorate('lifecycle', { draining: false });
  app.decorate('sessionCacheSeconds', opts.sessionCacheSeconds ?? env.SESSION_CACHE_SECONDS);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Order matters: connections, then session resolution, then security/rate limits keyed by user.
  await app.register(infraPlugin, { prisma: opts.prisma, redis: opts.redis });
  await app.register(errorsPlugin);
  await app.register(serializePlugin);
  await app.register(authPlugin);
  await app.register(securityPlugin);
  await app.register(idempotencyPlugin);
  if (opts.docs ?? docsEnabledFor(env)) await app.register(docsPlugin);
  await app.register(realtimeGateway);
  await app.register(metricsPlugin);
  await app.register(queueBoardPlugin);

  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(agentRoutes);
  await app.register(uploadRoutes);
  await app.register(farmRoutes);
  await app.register(farmerRoutes);
  await app.register(favoriteRoutes);
  await app.register(catalogRoutes);
  await app.register(supplyRoutes);
  await app.register(demandRoutes);
  await app.register(matchRoutes);
  await app.register(addressRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
  await app.register(conversationRoutes);
  await app.register(dashboardRoutes);
  await app.register(qaRoutes);
  await app.register(staffRoutes);
  await app.register(logisticsRoutes);
  await app.register(crateRoutes);
  await app.register(paymentRoutes);
  await app.register(pricingRoutes);
  await app.register(inputRoutes);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(adminDetailRoutes);
  await app.register(webhookRoutes);

  return app;
}
