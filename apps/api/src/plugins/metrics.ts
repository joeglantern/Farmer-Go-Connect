import { timingSafeEqual } from 'node:crypto';
import { env } from '@farmgo/config';
import { getQueue, QUEUE_NAMES } from '@farmgo/core';
import fp from 'fastify-plugin';
import client from 'prom-client';

/**
 * Prometheus metrics at /metrics: HTTP latency, WebSocket connections, job queue depth and
 * M-Pesa outcomes. Protected by METRICS_TOKEN (send `Authorization: Bearer <token>`), which
 * production requires; Caddy also hides the path from the public hostname.
 */
export default fp(
  async (app) => {
    const registry = new client.Registry();
    client.collectDefaultMetrics({ register: registry, prefix: 'farmgo_' });

    const httpDuration = new client.Histogram({
      name: 'farmgo_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [registry],
    });

    new client.Gauge({
      name: 'farmgo_ws_connections',
      help: 'Open WebSocket connections on this instance',
      registers: [registry],
      collect() {
        this.set(app.realtimeHub?.size ?? 0);
      },
    });

    const queueDepth = new client.Gauge({
      name: 'farmgo_queue_jobs',
      help: 'Jobs per queue and state',
      labelNames: ['queue', 'state'],
      registers: [registry],
    });

    const paymentsByStatus = new client.Gauge({
      name: 'farmgo_payments_last_24h',
      help: 'Payments created in the last 24 hours by method and status',
      labelNames: ['method', 'status'],
      registers: [registry],
    });

    const payoutsByStatus = new client.Gauge({
      name: 'farmgo_payouts_last_24h',
      help: 'Farmer payouts created in the last 24 hours by status',
      labelNames: ['status'],
      registers: [registry],
    });

    const outboxBacklog = new client.Gauge({
      name: 'farmgo_outbox_pending',
      help: 'Domain events waiting to be relayed',
      registers: [registry],
    });

    app.addHook('onResponse', async (req, reply) => {
      const route = req.routeOptions.url ?? 'unknown';
      if (route === '/metrics') return;
      httpDuration.observe(
        { method: req.method, route, status: String(reply.statusCode) },
        reply.elapsedTime / 1000,
      );
    });

    async function refreshBusinessGauges() {
      const since = new Date(Date.now() - 86_400_000);
      const [counts, payments, payouts, pending] = await Promise.all([
        Promise.all(QUEUE_NAMES.map(async (q) => [q, await getQueue(q).getJobCounts()] as const)),
        app.prisma.payment.groupBy({
          by: ['method', 'status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        app.prisma.payout.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        app.prisma.outboxEvent.count({ where: { processedAt: null } }),
      ]);
      queueDepth.reset();
      for (const [q, c] of counts)
        for (const [state, n] of Object.entries(c)) queueDepth.set({ queue: q, state }, n);
      paymentsByStatus.reset();
      for (const p of payments) paymentsByStatus.set({ method: p.method, status: p.status }, p._count._all);
      payoutsByStatus.reset();
      for (const p of payouts) payoutsByStatus.set({ status: p.status }, p._count._all);
      outboxBacklog.set(pending);
    }

    app.get('/metrics', { schema: { hide: true }, config: { rateLimit: false } }, async (req, reply) => {
      const token = env.METRICS_TOKEN;
      if (token) {
        const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        const want = Buffer.from(token);
        if (given.length !== want.length || !timingSafeEqual(given, want))
          return reply.status(401).send('unauthorized');
      }
      await refreshBusinessGauges().catch((err) => req.log.warn({ err }, 'metrics refresh failed'));
      return reply.type(registry.contentType).send(await registry.metrics());
    });
  },
  { name: 'metrics', dependencies: ['infra'] },
);
