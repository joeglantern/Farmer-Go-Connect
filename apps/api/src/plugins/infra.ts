import { createRedis } from '@farmgo/core';
import { prisma as defaultPrisma, type PrismaClient } from '@farmgo/db';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

export interface InfraOptions {
  prisma?: PrismaClient;
  redis?: Redis;
}

/** Database and Redis connections, closed when the server shuts down. */
export default fp<InfraOptions>(
  async (app, opts) => {
    const prisma = opts.prisma ?? defaultPrisma;
    const redis = opts.redis ?? createRedis();
    app.decorate('prisma', prisma);
    app.decorate('redis', redis);
    // Start serving with Redis connected: auth and money routes refuse while it is not, so a
    // replica that is still connecting would answer 503 to its first requests.
    if (redis.status !== 'ready') {
      const ready = await Promise.race([
        new Promise<boolean>((resolve) => redis.once('ready', () => resolve(true))),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000).unref()),
      ]);
      if (!ready) app.log.warn('Redis is not reachable yet; auth and payment routes will refuse until it is');
    }
    app.addHook('onClose', async () => {
      if (!opts.redis) await redis.quit().catch(() => undefined);
      if (!opts.prisma) await prisma.$disconnect();
    });
  },
  { name: 'infra' },
);
