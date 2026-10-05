import { type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedis } from './redis.js';

/** Every BullMQ queue and the payload of each job it carries. */
export interface QueueJobs {
  outbox: { relay: Record<string, never> };
  matching: {
    'match-demand': { demandId: string };
    'match-supply': { listingId: string };
    'expire-matches': Record<string, never>;
  };
  demand: {
    'expand-recurring': Record<string, never>;
    'aggregate-weekly': Record<string, never>;
    'expire-demand': Record<string, never>;
  };
  notify: {
    sms: { to: string; message: string; userId?: string; kind?: 'otp' | 'transactional' };
    push: { userId: string; title: string; body: string; data?: Record<string, unknown> };
    email: { to: string; subject: string; html: string; text: string };
    'event-notification': { type: string; payload: Record<string, unknown> };
  };
  payments: {
    'stk-timeout-check': { paymentId: string };
    'b2c-payout': { orderId: string };
    'b2c-input-payout': { inputOrderId: string };
    refund: { paymentId: string };
    'settle-delivered': Record<string, never>;
    reconcile: Record<string, never>;
    'invoice-generate': Record<string, never>;
    'invoice-overdue': Record<string, never>;
  };
  logistics: {
    'build-routes': { date?: string; county?: string };
  };
  pricing: {
    'rollup-price-index': { week?: string };
    'forecast-demand': Record<string, never>;
  };
  reminders: {
    'harvest-reminder': Record<string, never>;
    'crate-return-nudge': Record<string, never>;
    'listing-expiry': Record<string, never>;
    'reliability-refresh': Record<string, never>;
    'outbox-cleanup': Record<string, never>;
  };
}

export type QueueName = keyof QueueJobs;
export type JobName<Q extends QueueName> = keyof QueueJobs[Q] & string;
export type JobData<Q extends QueueName, J extends JobName<Q>> = QueueJobs[Q][J];

export const QUEUE_NAMES: QueueName[] = [
  'outbox',
  'matching',
  'demand',
  'notify',
  'payments',
  'logistics',
  'pricing',
  'reminders',
];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

export function queueConnection(): Redis {
  connection ??= createRedis();
  return connection;
}

export function getQueue<Q extends QueueName>(name: Q): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: queueConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
      prefix: 'farmgo',
    });
    queues.set(name, q);
  }
  return q;
}

/**
 * Typed enqueue. Pass `jobId` for idempotency: BullMQ ignores a second add with the same id
 * while the first job still exists.
 */
export async function enqueue<Q extends QueueName, J extends JobName<Q>>(
  queue: Q,
  job: J,
  data: JobData<Q, J>,
  opts: JobsOptions = {},
): Promise<void> {
  await getQueue(queue).add(job, data, opts);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}
