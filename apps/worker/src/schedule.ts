import { getQueue, type JobName, logger, type QueueName } from '@farmgo/core';

const TZ = 'Africa/Nairobi';

interface Cron {
  queue: QueueName;
  job: string;
  pattern: string;
  why: string;
}

/** Scheduled jobs (Nairobi time). Admins can also trigger these via POST /v1/admin/jobs/:name/run. */
export const SCHEDULE: Cron[] = [
  {
    queue: 'matching',
    job: 'expire-matches',
    pattern: '*/15 * * * *',
    why: 'free stock held by stale proposals',
  },
  {
    queue: 'payments',
    job: 'reconcile',
    pattern: '*/5 * * * *',
    why: 'settle STK payments whose callback never came',
  },
  {
    queue: 'payments',
    job: 'settle-delivered',
    pattern: '15 * * * *',
    why: 'release payment to farmers once the dispute window closes',
  },
  { queue: 'demand', job: 'expire-demand', pattern: '0 1 * * *', why: 'close past demand and listings' },
  {
    queue: 'demand',
    job: 'expand-recurring',
    pattern: '0 2 * * *',
    why: 'create upcoming instances of recurring demand',
  },
  {
    queue: 'reminders',
    job: 'reliability-refresh',
    pattern: '30 3 * * *',
    why: 'update farmer stats used by matching',
  },
  {
    queue: 'reminders',
    job: 'outbox-cleanup',
    pattern: '0 4 * * *',
    why: 'trim processed events and old GPS pings',
  },
  {
    queue: 'demand',
    job: 'aggregate-weekly',
    pattern: '0 6 * * 1',
    why: 'Monday digest of what buyers need',
  },
  { queue: 'pricing', job: 'forecast-demand', pattern: '0 3 * * 1', why: 'weekly demand forecast' },
  {
    queue: 'payments',
    job: 'invoice-generate',
    pattern: '0 7 * * 1',
    why: 'bill credit-terms buyers weekly',
  },
  { queue: 'payments', job: 'invoice-overdue', pattern: '0 8 * * *', why: 'flag unpaid invoices' },
  {
    queue: 'reminders',
    job: 'crate-return-nudge',
    pattern: '0 10 * * *',
    why: 'ask buyers to return crates',
  },
  { queue: 'logistics', job: 'build-routes', pattern: '0 16 * * *', why: "plan tomorrow's deliveries" },
  {
    queue: 'reminders',
    job: 'harvest-reminder',
    pattern: '0 17 * * *',
    why: 'remind farmers of tomorrow orders',
  },
  {
    queue: 'pricing',
    job: 'rollup-price-index',
    pattern: '30 23 * * *',
    why: 'update the public price index',
  },
];

/** Register repeatable jobs. BullMQ de-duplicates schedulers by id, so this is safe on every boot. */
export async function registerSchedules() {
  for (const c of SCHEDULE) {
    await getQueue(c.queue).upsertJobScheduler(
      `cron:${c.queue}:${c.job}`,
      { pattern: c.pattern, tz: TZ },
      { name: c.job as JobName<typeof c.queue>, data: {} },
    );
  }
  logger.info({ count: SCHEDULE.length }, 'job schedules registered');
}
