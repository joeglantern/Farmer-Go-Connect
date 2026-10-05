import { env } from '@farmgo/config';
import type { DomainEventType } from '@farmgo/contracts';
import { num, type PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import { payoutReference } from '../domain/payments.js';
import { getSetting } from '../domain/settings.js';
import { type NotifyArgs, notifyMany, notifyUser, orgContacts, usersWithRole } from './notify.js';

const kes = (cents: number) => (cents / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const day = (d: Date) => d.toISOString().slice(0, 10);
const ussd = env.AT_USSD_CODE;

async function orderFacts(prisma: PrismaClient, orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { listing: { include: { produce: true } } } },
      buyerOrg: { include: { profile: true } },
    },
  });
}

/**
 * Decide who hears about a domain event and in which words. Runs in the notify worker.
 */
export async function handleEventNotification(
  prisma: PrismaClient,
  redis: Redis,
  type: DomainEventType,
  p: Record<string, unknown>,
): Promise<void> {
  const send = (users: string[], a: NotifyArgs) => notifyMany(prisma, redis, users, a);

  switch (type) {
    case 'farmer.created_by_agent': {
      const user = await prisma.user.findUnique({ where: { id: p.userId as string } });
      if (user) {
        await notifyUser(prisma, redis, user.id, {
          template: 'welcome_farmer',
          link: { route: 'profile', params: {} },
          vars: { name: user.name, ussd },
          type,
          importance: 'high',
        });
      }
      return;
    }

    case 'match.proposed': {
      const m = await prisma.match.findUnique({
        where: { id: p.matchId as string },
        include: { demand: true, listing: { include: { produce: true } } },
      });
      if (!m) return;
      const vars = {
        qty: num(m.quantity),
        unit: m.listing.produce.unit.toLowerCase(),
        produce: m.listing.produce.name,
        date: day(m.demand.neededBy),
        price: kes(m.pricePerUnit),
        ussd,
      };
      const data = { matchId: m.id, demandId: m.demandId, listingId: m.listingId };
      await send(await orgContacts(prisma, m.demand.buyerOrgId), {
        template: 'match_proposed_buyer',
        link: { route: 'match', params: { id: m.id } },
        vars,
        type,
        data,
        importance: 'low',
        email: true,
      });
      await send([p.farmerUserId as string], {
        template: 'match_proposed_farmer',
        link: { route: 'match', params: { id: m.id } },
        vars,
        type,
        data,
        importance: 'high',
      });
      return;
    }

    case 'match.accepted': {
      if (!p.orderId) return;
      const o = await prisma.order.findUnique({ where: { id: p.orderId as string } });
      if (!o) return;
      const a: NotifyArgs = {
        template: 'match_accepted',
        link: { route: 'order', params: { id: o.id } },
        vars: { code: o.code },
        type,
        data: { orderId: o.id },
        importance: 'normal',
      };
      await send([...(await orgContacts(prisma, o.buyerOrgId)), o.farmerId], a);
      return;
    }

    case 'order.created': {
      const o = await orderFacts(prisma, p.orderId as string);
      if (o?.status !== 'PENDING') return; // matched orders were already announced as "deal agreed"
      const item = o.items[0]!;
      await notifyUser(prisma, redis, o.farmerId, {
        template: 'order_new_farmer',
        link: { route: 'order', params: { id: o.id } },
        vars: {
          code: o.code,
          qty: num(item.quantity),
          unit: item.listing.produce.unit.toLowerCase(),
          produce: item.listing.produce.name,
          date: day(o.deliveryDate),
          ussd,
        },
        type,
        data: { orderId: o.id },
        importance: 'high',
      });
      return;
    }

    case 'order.status_changed': {
      const o = await orderFacts(prisma, p.orderId as string);
      if (!o) return;
      const buyers = await orgContacts(prisma, o.buyerOrgId);
      const data = { orderId: o.id, status: p.to };
      const base = { code: o.code, date: day(o.deliveryDate) };
      switch (p.to) {
        case 'CONFIRMED':
          if (p.from === 'PENDING')
            await send(buyers, {
              template: 'order_confirmed',
              vars: base,
              type,
              data,
              link: { route: 'order', params: { id: o.id } },
              importance: 'low',
            });
          break;
        case 'READY_FOR_QA': {
          const county = o.buyerOrg.profile?.county;
          await send(await usersWithRole(prisma, 'qa_officer', county), {
            template: 'order_ready_for_qa',
            link: { route: 'order', params: { id: o.id } },
            vars: { ...base, county: county ?? '' },
            type,
            data,
            importance: 'normal',
          });
          break;
        }
        case 'QA_PASSED':
          await send([...buyers, o.farmerId], {
            template: 'order_qa_passed',
            link: { route: 'order', params: { id: o.id } },
            vars: base,
            type,
            data,
            importance: 'low',
          });
          break;
        case 'QA_REJECTED': {
          const insp = await prisma.qualityInspection.findFirst({
            where: { orderItem: { orderId: o.id }, passed: false },
          });
          await send([...buyers, o.farmerId], {
            template: 'order_qa_rejected',
            link: { route: 'order', params: { id: o.id } },
            vars: { ...base, reason: insp?.rejectReason ?? '' },
            type,
            data,
            importance: 'high',
          });
          break;
        }
        case 'IN_TRANSIT':
          await send(buyers, {
            template: 'order_in_transit',
            vars: base,
            type,
            data,
            link: { route: 'order', params: { id: o.id } },
            importance: 'low',
          });
          break;
        case 'DELIVERED': {
          const hours = await getSetting(prisma, 'disputeWindowHours');
          await send(buyers, {
            template: 'order_delivered_buyer',
            link: { route: 'order', params: { id: o.id } },
            vars: { ...base, hours },
            type,
            data,
            importance: 'low',
            email: true,
          });
          await send([o.farmerId], {
            template: 'order_delivered_farmer',
            link: { route: 'order', params: { id: o.id } },
            vars: base,
            type,
            data,
            importance: 'normal',
          });
          break;
        }
        case 'CANCELLED':
          await send([...buyers, o.farmerId], {
            template: 'order_cancelled',
            link: { route: 'order', params: { id: o.id } },
            vars: { ...base, reason: o.cancelReason ?? '' },
            type,
            data,
            importance: 'high',
          });
          break;
      }
      return;
    }

    case 'order.message': {
      const [o, msg] = await Promise.all([
        prisma.order.findUnique({ where: { id: p.orderId as string } }),
        prisma.orderMessage.findUnique({ where: { id: p.messageId as string }, include: { author: true } }),
      ]);
      if (!o || !msg) return;
      const parties = [...(await orgContacts(prisma, o.buyerOrgId)), o.farmerId].filter(
        (u) => u !== msg.authorId,
      );
      await send(parties, {
        template: 'order_message',
        link: { route: 'order', params: { id: o.id, section: 'messages' } },
        vars: { code: o.code, author: msg.author.name, preview: msg.body.slice(0, 80) },
        type,
        data: { orderId: o.id, messageId: msg.id },
        importance: 'low',
      });
      return;
    }

    case 'demand.aggregated': {
      // Farmers in the county who have grown this produce before.
      const produce = await prisma.produce.findUnique({ where: { id: p.produceId as string } });
      if (!produce) return;
      const farmers = await prisma.farmerProfile.findMany({
        where: {
          farms: { some: { county: p.county as string, listings: { some: { produceId: produce.id } } } },
        },
        select: { userId: true },
        take: 500,
      });
      await send(
        farmers.map((f) => f.userId),
        {
          template: 'demand_digest',
          link: { route: 'demandBoard', params: { produceId: produce.id, county: p.county as string } },
          vars: {
            produce: produce.name,
            county: p.county as string,
            qty: p.totalQty as number,
            unit: produce.unit.toLowerCase(),
            week: p.week as string,
          },
          type,
          data: { produceId: produce.id, county: p.county },
          importance: 'normal',
        },
      );
      return;
    }

    case 'payment.updated': {
      if (p.status !== 'SUCCESS' && p.status !== 'FAILED' && p.status !== 'CANCELLED') return;
      const pay = await prisma.payment.findUnique({
        where: { id: p.paymentId as string },
        include: {
          order: true,
          invoice: true,
          checkout: { include: { orders: { select: { code: true }, orderBy: { createdAt: 'asc' } } } },
        },
      });
      // Per-order shares of a checkout payment are ledger entries: notify once, for the checkout.
      if (pay?.direction !== 'IN' || pay.allocatedFromId) return;
      const orgId = pay.order?.buyerOrgId ?? pay.checkout?.buyerOrgId ?? pay.invoice?.buyerOrgId;
      if (!orgId) return;
      const reference =
        pay.order?.code ?? pay.invoice?.number ?? pay.checkout?.orders.map((o) => o.code).join(', ') ?? '';
      const ok = p.status === 'SUCCESS';
      await send(await orgContacts(prisma, orgId), {
        template: ok ? 'payment_success' : 'payment_failed',
        link: pay.orderId
          ? { route: 'order', params: { id: pay.orderId } }
          : pay.checkoutId
            ? { route: 'checkout', params: { id: pay.checkoutId } }
            : { route: 'invoice', params: { id: pay.invoiceId ?? '' } },
        vars: { amount: kes(pay.amount), reference, receipt: pay.mpesaReceipt ?? '' },
        type,
        data: { paymentId: pay.id, orderId: pay.orderId },
        importance: ok ? 'low' : 'normal',
        email: ok,
      });
      return;
    }

    case 'payout.updated': {
      const payout = await prisma.payout.findUnique({
        where: { id: p.payoutId as string },
        include: { order: true },
      });
      if (!payout) return;
      if (p.status === 'SUCCESS') {
        await notifyUser(prisma, redis, payout.farmerId, {
          template: 'payout_success',
          link: payout.orderId
            ? { route: 'payout', params: { orderId: payout.orderId } }
            : { route: 'inputOrder', params: { id: payout.inputOrderId ?? '' } },
          vars: { amount: kes(payout.amount), code: payoutReference(payout) },
          type,
          data: { orderId: payout.orderId },
          importance: 'high',
        });
      } else if (p.status === 'FAILED') {
        await send(await usersWithRole(prisma, 'admin'), {
          template: 'payout_failed_admin',
          link: payout.orderId
            ? { route: 'payout', params: { orderId: payout.orderId } }
            : { route: 'inputOrder', params: { id: payout.inputOrderId ?? '' } },
          vars: { code: payoutReference(payout), reason: payout.resultDesc ?? '' },
          type,
          data: { orderId: payout.orderId },
          importance: 'low',
        });
      }
      return;
    }

    case 'route.assigned': {
      const r = await prisma.route.findUnique({
        where: { id: p.routeId as string },
        include: { _count: { select: { stops: true } } },
      });
      if (!r?.driverId) return;
      await notifyUser(prisma, redis, r.driverId, {
        template: 'route_assigned',
        link: { route: 'route', params: { id: r.id } },
        vars: { code: r.code, date: day(r.date), stops: r._count.stops },
        type,
        data: { routeId: r.id },
        importance: 'normal',
      });
      return;
    }

    case 'dispute.opened': {
      const d = await prisma.dispute.findUnique({
        where: { id: p.disputeId as string },
        include: { order: true },
      });
      if (!d?.order) return; // problems on green-input orders are handled by admins directly
      const a: NotifyArgs = {
        template: 'dispute_opened',
        link: { route: 'order', params: { id: d.order.id, section: 'dispute' } },
        vars: { code: d.order.code, reason: d.reason.toLowerCase() },
        type,
        data: { orderId: d.orderId, disputeId: d.id },
        importance: 'normal',
      };
      await send([d.order.farmerId, ...(await usersWithRole(prisma, 'admin'))], a);
      return;
    }

    case 'dispute.resolved': {
      const d = await prisma.dispute.findUnique({
        where: { id: p.disputeId as string },
        include: { order: true },
      });
      if (!d?.order) return;
      const outcome =
        d.status === 'RESOLVED_REFUND' ? `refund of KES ${kes(d.refundAmount ?? 0)}` : 'no refund';
      await send([...(await orgContacts(prisma, d.order.buyerOrgId)), d.order.farmerId], {
        template: 'dispute_resolved',
        link: { route: 'order', params: { id: d.order.id, section: 'dispute' } },
        vars: { code: d.order.code, outcome },
        type,
        data: { orderId: d.orderId },
        importance: 'normal',
      });
      return;
    }

    case 'input_order.created':
    case 'input_order.status_changed': {
      const io = await prisma.inputOrder.findUnique({
        where: { id: p.inputOrderId as string },
        include: { product: true },
      });
      if (!io) return;
      if (type === 'input_order.created') {
        await send(await orgContacts(prisma, io.product.supplierOrgId), {
          template: 'input_order_new',
          link: { route: 'inputOrder', params: { id: io.id } },
          vars: { product: io.product.name, qty: num(io.quantity), unit: io.product.unit.toLowerCase() },
          type,
          data: { inputOrderId: io.id },
          importance: 'normal',
        });
      } else {
        await notifyUser(prisma, redis, io.buyerId, {
          template: 'input_order_status',
          link: { route: 'inputOrder', params: { id: io.id } },
          vars: { product: io.product.name, status: io.status.toLowerCase() },
          type,
          data: { inputOrderId: io.id },
          importance: 'normal',
        });
      }
      return;
    }

    default:
      return;
  }
}
