import { HealthLiveDto, HealthReadyDto } from '@farmgo/contracts';
import { storageHealthy } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { typed } from '../lib/route.js';

export default async function healthRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/health/live',
    {
      schema: { tags: ['health'], summary: 'Process is up', response: { 200: HealthLiveDto } },
      config: { rateLimit: false },
    },
    async () => ({ status: 'ok' as const }),
  );

  r.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Dependencies reachable',
        response: { 200: HealthReadyDto, 503: HealthReadyDto },
      },
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const idle = { ok: true, ms: 0 };
      if (app.lifecycle.draining) {
        return reply.status(503).send({
          status: 'draining' as const,
          checks: { database: idle, redis: idle, storage: idle },
          websocketClients: app.realtimeHub?.size ?? 0,
        });
      }
      const check = async (fn: () => Promise<unknown>) => {
        const started = Date.now();
        try {
          await fn();
          return { ok: true, ms: Date.now() - started };
        } catch (err) {
          return {
            ok: false,
            ms: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };
      const [database, redis, storage] = await Promise.all([
        check(() => app.prisma.$queryRawUnsafe('SELECT 1')),
        check(() => app.redis.ping()),
        check(async () => {
          if (!(await storageHealthy())) throw new Error('bucket not reachable');
        }),
      ]);
      const ok = database.ok && redis.ok;
      return reply.status(ok ? 200 : 503).send({
        status: ok ? ('ok' as const) : ('degraded' as const),
        checks: { database, redis, storage },
        websocketClients: app.realtimeHub?.size ?? 0,
      });
    },
  );
}
