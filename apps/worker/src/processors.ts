import type { DomainEventType } from '@farmgo/contracts';
import {
  buildRoutes,
  checkStkStatus,
  enqueue,
  executeInputPayout,
  executePayout,
  executeRefund,
  expandRecurringDemand,
  expireMatches,
  expireStale,
  forecastDemand,
  generateInvoices,
  getPushProvider,
  getSmsProvider,
  handleEventNotification,
  logger,
  markOverdueInvoices,
  matchDemand,
  matchListing,
  publishWeeklyDemand,
  type QueueJobs,
  type QueueName,
  reconcilePayments,
  refreshReliability,
  rollupPriceIndex,
  sendCrateReturnNudges,
  sendEmail,
  sendHarvestReminders,
  settleDeliveredOrders,
  settleInputOrders,
  weekStart,
} from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

export interface Deps {
  prisma: PrismaClient;
  redis: Redis;
}

type Handler = (job: Job, deps: Deps) => Promise<unknown>;
type Handlers = { [Q in QueueName]: { [J in keyof QueueJobs[Q]]: Handler } };

const data = <T>(job: Job) => job.data as T;

/** One handler per job name, per queue. Every handler is idempotent (jobs may run twice). */
export const handlers: Handlers = {
  outbox: {
    relay: async () => undefined, // the relay runs as a dedicated loop, see outbox-relay.ts
  },

  matching: {
    'match-demand': async (job, { prisma }) =>
      (await matchDemand(prisma, data<{ demandId: string }>(job).demandId)).length,
    'match-supply': async (job, { prisma }) =>
      matchListing(prisma, data<{ listingId: string }>(job).listingId),
    'expire-matches': async (_job, { prisma }) => expireMatches(prisma),
  },

  demand: {
    'expand-recurring': async (_job, { prisma }) => expandRecurringDemand(prisma),
    'aggregate-weekly': async (_job, { prisma }) => publishWeeklyDemand(prisma),
    'expire-demand': async (_job, { prisma }) => expireStale(prisma),
  },

  notify: {
    sms: async (job, { prisma }) => {
      const d = data<QueueJobs['notify']['sms']>(job);
      // Don't text someone who has been banned since the job was queued (OTP excepted).
      if (d.userId && d.kind !== 'otp') {
        const u = await prisma.user.findUnique({ where: { id: d.userId }, select: { banned: true } });
        if (u?.banned) return 'skipped';
      }
      return getSmsProvider().send(d.to, d.message);
    },
    push: async (job, { prisma }) => {
      const d = data<QueueJobs['notify']['push']>(job);
      const devices = await prisma.deviceToken.findMany({ where: { userId: d.userId } });
      if (!devices.length) return 'no devices';
      const tickets = await getPushProvider().send(
        devices.map((dev) => ({ to: dev.token, title: d.title, body: d.body, data: d.data })),
      );
      const invalid = tickets.filter((t) => t.invalidToken).map((t) => t.token);
      if (invalid.length) await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
      return { sent: tickets.filter((t) => t.ok).length, removed: invalid.length };
    },
    email: async (job) => sendEmail(data<QueueJobs['notify']['email']>(job)),
    'event-notification': async (job, { prisma, redis }) => {
      const d = data<QueueJobs['notify']['event-notification']>(job);
      await handleEventNotification(prisma, redis, d.type as DomainEventType, d.payload);
    },
  },

  payments: {
    'stk-timeout-check': async (job, { prisma }) => {
      const { paymentId } = data<{ paymentId: string }>(job);
      const state = await checkStkStatus(prisma, paymentId);
      if (state === 'pending') {
        // Still waiting on the customer: look again in 30 seconds.
        await enqueue(
          'payments',
          'stk-timeout-check',
          { paymentId },
          { delay: 30_000, jobId: `stk-check-${paymentId}-${Date.now()}` },
        );
      }
      return state;
    },
    'b2c-payout': async (job, { prisma }) =>
      (await executePayout(prisma, data<{ orderId: string }>(job).orderId))?.status,
    'b2c-input-payout': async (job, { prisma }) =>
      (await executeInputPayout(prisma, data<{ inputOrderId: string }>(job).inputOrderId))?.status,
    refund: async (job, { prisma }) => executeRefund(prisma, data<{ paymentId: string }>(job).paymentId),
    reconcile: async (_job, { prisma }) => reconcilePayments(prisma),
    'settle-delivered': async (_job, { prisma }) =>
      (await settleDeliveredOrders(prisma)) + (await settleInputOrders(prisma)),
    'invoice-generate': async (_job, { prisma }) => generateInvoices(prisma),
    'invoice-overdue': async (_job, { prisma }) => markOverdueInvoices(prisma),
  },

  logistics: {
    'build-routes': async (job, { prisma }) => {
      const d = data<{ date?: string; county?: string }>(job);
      // Default: plan tomorrow's deliveries.
      const date = d.date ? new Date(d.date) : new Date(Date.now() + 86_400_000);
      return (await buildRoutes(prisma, date, d.county)).length;
    },
  },

  pricing: {
    'rollup-price-index': async (job, { prisma }) => {
      const d = data<{ week?: string }>(job);
      const week = d.week ? new Date(d.week) : weekStart(new Date());
      // Also refresh last week so late status changes are counted.
      const last = await rollupPriceIndex(prisma, new Date(week.getTime() - 7 * 86_400_000));
      return last + (await rollupPriceIndex(prisma, week));
    },
    'forecast-demand': async (_job, { prisma }) => forecastDemand(prisma),
  },

  reminders: {
    'harvest-reminder': async (_job, { prisma, redis }) => sendHarvestReminders(prisma, redis),
    'crate-return-nudge': async (_job, { prisma, redis }) => sendCrateReturnNudges(prisma, redis),
    'listing-expiry': async (_job, { prisma }) => expireStale(prisma),
    'reliability-refresh': async (_job, { prisma }) => refreshReliability(prisma),
    'outbox-cleanup': async (_job, { prisma }) => {
      const cutoff = new Date(Date.now() - 14 * 86_400_000);
      const res = await prisma.outboxEvent.deleteMany({ where: { processedAt: { lt: cutoff } } });
      const locations = await prisma.driverLocation.deleteMany({
        where: { recordedAt: { lt: new Date(Date.now() - 90 * 86_400_000) } },
      });
      return { outbox: res.count, locations: locations.count };
    },
  },
};

export async function runJob(queue: QueueName, job: Job, deps: Deps) {
  const handler = (handlers[queue] as Record<string, Handler>)[job.name];
  if (!handler) {
    logger.error({ queue, job: job.name }, 'no handler for job');
    return;
  }
  return handler(job, deps);
}
