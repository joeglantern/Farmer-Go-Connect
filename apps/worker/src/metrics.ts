import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { env } from '@farmgo/config';
import { getQueue, QUEUE_NAMES } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';
import type { Job, Worker } from 'bullmq';
import client from 'prom-client';

/** Prometheus metrics for the worker: jobs done and failed, job duration, queue depth, outbox backlog. */
export function workerMetrics(prisma: PrismaClient) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'farmgo_worker_' });

  const jobs = new client.Counter({
    name: 'farmgo_worker_jobs_total',
    help: 'Jobs finished by queue, job name and outcome',
    labelNames: ['queue', 'job', 'outcome'],
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'farmgo_worker_job_duration_seconds',
    help: 'Time from a job starting to it finishing',
    labelNames: ['queue', 'job'],
    buckets: [0.05, 0.1, 0.5, 1, 2, 5, 15, 60],
    registers: [registry],
  });
  const depth = new client.Gauge({
    name: 'farmgo_queue_jobs',
    help: 'Jobs per queue and state',
    labelNames: ['queue', 'state'],
    registers: [registry],
  });
  const outbox = new client.Gauge({
    name: 'farmgo_outbox_pending',
    help: 'Domain events waiting to be relayed',
    registers: [registry],
  });
  new client.Gauge({
    name: 'farmgo_tester_stack',
    help: '1 when this deployment runs mock payment providers',
    registers: [registry],
    collect() {
      this.set(env.TESTER_STACK && env.ALLOW_MOCK_PROVIDERS ? 1 : 0);
    },
  });

  const observe = (queue: string, job: Job | undefined, outcome: 'completed' | 'failed') => {
    if (!job) return;
    jobs.inc({ queue, job: job.name, outcome });
    if (job.processedOn && job.finishedOn)
      duration.observe({ queue, job: job.name }, (job.finishedOn - job.processedOn) / 1000);
  };

  return {
    track(worker: Worker) {
      worker.on('completed', (job) => observe(worker.name, job, 'completed'));
      worker.on('failed', (job) => observe(worker.name, job, 'failed'));
    },
    authorized(req: IncomingMessage) {
      if (!env.METRICS_TOKEN) return true;
      const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      const want = Buffer.from(env.METRICS_TOKEN);
      return given.length === want.length && timingSafeEqual(given, want);
    },
    async render() {
      const [counts, pending] = await Promise.all([
        Promise.all(QUEUE_NAMES.map(async (q) => [q, await getQueue(q).getJobCounts()] as const)),
        prisma.outboxEvent.count({ where: { processedAt: null } }),
      ]).catch(() => [[], null] as const);
      depth.reset();
      for (const [q, c] of counts)
        for (const [state, n] of Object.entries(c)) depth.set({ queue: q, state }, n);
      if (pending !== null) outbox.set(pending);
      return { contentType: registry.contentType, body: await registry.metrics() };
    },
  };
}
