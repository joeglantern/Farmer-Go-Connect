import { channels as ch, type DomainEvents, type DomainEventType } from '@farmgo/contracts';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import { requestPayout } from './domain/payments.js';
import type { OutboxRow } from './outbox.js';
import { enqueue } from './queues.js';
import { publishRealtime } from './realtime.js';

/** Realtime channels each domain event is delivered to. */
export function channelsFor<T extends DomainEventType>(type: T, p: DomainEvents[T]): string[] {
  const e = p as Record<string, unknown>;
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : undefined);
  const out: (string | undefined)[] = [];
  switch (type) {
    case 'demand.created':
      out.push(ch.org(s('buyerOrgId')!), ch.demand(s('county')!));
      break;
    case 'demand.updated':
    case 'demand.cancelled':
      out.push(ch.org(s('buyerOrgId')!));
      break;
    case 'demand.aggregated':
      out.push(ch.demand(s('county')!));
      break;
    case 'supply.created':
    case 'supply.updated':
    case 'supply.harvest_ready':
      out.push(ch.user(s('farmerUserId')!));
      break;
    case 'match.proposed':
    case 'match.accepted':
    case 'match.rejected':
    case 'match.expired':
      out.push(ch.org(s('buyerOrgId')!), ch.user(s('farmerUserId')!));
      break;
    case 'order.created':
    case 'order.message':
      out.push(ch.order(s('orderId')!), ch.org(s('buyerOrgId')!), ch.user(s('farmerId')!));
      break;
    case 'order.status_changed': {
      out.push(ch.order(s('orderId')!), ch.org(s('buyerOrgId')!), ch.user(s('farmerId')!));
      if (s('to') === 'READY_FOR_QA') {
        out.push(ch.role('qa_officer'));
        if (s('county')) out.push(ch.role('qa_officer', s('county')));
      }
      if (s('to') === 'QA_PASSED' || s('to') === 'DISPUTED') out.push(ch.role('admin'));
      break;
    }
    case 'qa.completed':
      out.push(ch.order(s('orderId')!));
      break;
    case 'route.assigned':
      out.push(ch.route(s('routeId')!), ch.user(s('driverId')!), ch.role('admin'));
      break;
    case 'route.updated':
      out.push(
        ch.route(s('routeId')!),
        s('driverId') ? ch.user(s('driverId')!) : undefined,
        ch.role('admin'),
      );
      break;
    case 'delivery.location':
      out.push(ch.route(s('routeId')!), ...((e.orderIds as string[]) ?? []).map(ch.order));
      break;
    case 'delivery.stop_updated':
      out.push(ch.route(s('routeId')!), ch.order(s('orderId')!));
      break;
    case 'payment.updated':
      out.push(
        s('buyerOrgId') ? ch.org(s('buyerOrgId')!) : undefined,
        s('orderId') ? ch.order(s('orderId')!) : undefined,
      );
      break;
    case 'payout.updated':
      out.push(ch.user(s('farmerId')!), ch.order(s('orderId')!));
      if (s('status') === 'FAILED') out.push(ch.role('admin'));
      break;
    case 'dispute.opened':
    case 'dispute.resolved':
      out.push(ch.order(s('orderId')!), ch.org(s('buyerOrgId')!), ch.user(s('farmerId')!), ch.role('admin'));
      break;
    case 'crate.moved':
      out.push(ch.role('admin'));
      break;
    case 'input_order.created':
    case 'input_order.status_changed':
      out.push(ch.org(s('supplierOrgId')!), ch.user(s('buyerId')!));
      break;
    case 'price.updated':
      out.push(ch.prices(s('county')!));
      break;
    case 'notification.new':
      out.push(ch.user(s('userId')!));
      break;
    case 'user.onboarded':
    case 'farmer.created_by_agent':
      out.push(ch.role('admin'));
      break;
    case 'payout.requested':
    case 'refund.requested':
      break;
  }
  return out.filter((c): c is string => !!c);
}

/** Events that produce user notifications (handled by the notify worker). */
const NOTIFYING = new Set<DomainEventType>([
  'farmer.created_by_agent',
  'match.proposed',
  'match.accepted',
  'order.created',
  'order.status_changed',
  'order.message',
  'demand.aggregated',
  'payment.updated',
  'payout.updated',
  'route.assigned',
  'dispute.opened',
  'dispute.resolved',
  'input_order.created',
  'input_order.status_changed',
]);

/**
 * Handle one outbox event: fan out to realtime channels, trigger follow-up work, and queue
 * user notifications. Called by the outbox relay; must be idempotent (at-least-once delivery).
 */
export async function routeEvent(prisma: PrismaClient, redis: Redis, row: OutboxRow): Promise<void> {
  const type = row.type as DomainEventType;
  const payload = row.payload as DomainEvents[typeof type];
  const eventId = row.id.toString();

  await publishRealtime(redis, channelsFor(type, payload), type, payload);

  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'demand.created':
      await enqueue(
        'matching',
        'match-demand',
        { demandId: p.demandId as string },
        { jobId: `md-${eventId}` },
      );
      break;
    case 'supply.created':
    case 'supply.updated':
      await enqueue(
        'matching',
        'match-supply',
        { listingId: p.listingId as string },
        { jobId: `ms-${eventId}` },
      );
      break;
    case 'match.rejected':
    case 'match.expired': {
      const m = await prisma.match.findUnique({
        where: { id: p.matchId as string },
        select: { demandId: true },
      });
      if (m) await enqueue('matching', 'match-demand', { demandId: m.demandId }, { jobId: `md-${eventId}` });
      break;
    }
    case 'order.status_changed': {
      if (p.to === 'CANCELLED' || p.to === 'QA_REJECTED') {
        const items = await prisma.orderItem.findMany({
          where: { orderId: p.orderId as string, matchId: { not: null } },
          select: { match: { select: { demandId: true } } },
        });
        for (const i of items) {
          if (i.match)
            await enqueue(
              'matching',
              'match-demand',
              { demandId: i.match.demandId },
              { jobId: `md-${eventId}-${i.match.demandId}` },
            );
        }
      }
      break;
    }
    case 'payout.requested':
      await requestPayout(prisma, p.orderId as string);
      break;
    case 'refund.requested':
      await enqueue(
        'payments',
        'refund',
        { paymentId: p.paymentId as string },
        { jobId: `refund-${p.paymentId as string}` },
      );
      break;
    default:
      break;
  }

  if (NOTIFYING.has(type)) {
    await enqueue('notify', 'event-notification', { type, payload: p }, { jobId: `en-${eventId}` });
  }
}
