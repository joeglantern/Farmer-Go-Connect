import { createServer } from 'node:http';
import { env } from '@farmgo/config';
import {
  announceTesterStack,
  closeQueues,
  createRedis,
  logger,
  QUEUE_NAMES,
  type QueueName,
} from '@farmgo/core';
import { prisma } from '@farmgo/db';
import * as Sentry from '@sentry/node';
import { Worker } from 'bullmq';
import { workerMetrics } from './metrics.js';
import { OutboxRelay } from './outbox-relay.js';
import { runJob } from './processors.js';
import { registerSchedules } from './schedule.js';

process.env.SERVICE_NAME ??= 'farmgo-worker';
if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

/** Parallelism per queue: I/O-bound notification sending gets the most. */
const CONCURRENCY: Record<QueueName, number> = {
  outbox: 1,
  matching: 4,
  demand: 1,
  notify: 10,
  payments: 4,
  logistics: 1,
  pricing: 1,
  reminders: 2,
};

/** SMS provider limits: at most 20 messages per second across all workers. */
const LIMITERS: Partial<Record<QueueName, { max: number; duration: number }>> = {
  notify: { max: 20, duration: 1_000 },
};

let stopping = false;

async function main() {
  announceTesterStack();
  const redis = createRedis();
  const metrics = workerMetrics(prisma);
  const deps = { prisma, redis };
  const workers = QUEUE_NAMES.filter((q) => q !== 'outbox').map(
    (queue) =>
      new Worker(queue, (job) => runJob(queue, job, deps), {
        connection: createRedis(),
        prefix: 'farmgo',
        concurrency: CONCURRENCY[queue],
        limiter: LIMITERS[queue],
      }),
  );
  for (const w of workers) {
    metrics.track(w);
    w.on('failed', (job, err) => {
      logger.error(
        { queue: w.name, job: job?.name, id: job?.id, attempts: job?.attemptsMade, err },
        'job failed',
      );
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
        Sentry.captureException(err, { extra: { queue: w.name, job: job.name } });
    });
    w.on('error', (err) => logger.error({ queue: w.name, err }, 'worker error'));
  }

  const relay = new OutboxRelay(prisma, redis);
  await relay.start();
  await registerSchedules();

  // Liveness for container health checks, and Prometheus metrics at /metrics (METRICS_TOKEN).
  const port = Number(process.env.WORKER_PORT ?? 4001);
  const health = createServer((req, res) => {
    if (req.url?.startsWith('/metrics')) {
      if (!metrics.authorized(req)) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      metrics
        .render()
        .then(({ contentType, body }) => res.writeHead(200, { 'content-type': contentType }).end(body))
        .catch((err) => {
          logger.warn({ err }, 'worker metrics failed');
          res.writeHead(500).end();
        });
      return;
    }
    const ok = !stopping && workers.every((w) => w.isRunning());
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', queues: workers.map((w) => w.name) }));
  });
  health.listen(port, () => logger.info({ port, queues: workers.map((w) => w.name) }, 'worker running'));

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker shutting down');
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    health.close();
    await relay.stop();
    await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs
    await closeQueues();
    await redis.quit().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
