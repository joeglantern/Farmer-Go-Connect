import { env } from '@farmgo/config';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import { notifyMany, notifyUser, orgContacts } from '../notifications/notify.js';
import { getSetting } from './settings.js';

/** Remind farmers the day before a confirmed order is due to mark it harvested. */
export async function sendHarvestReminders(
  prisma: PrismaClient,
  redis: Redis,
  now = new Date(),
): Promise<number> {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const dayAfter = new Date(tomorrow.getTime() + 86_400_000);
  const orders = await prisma.order.findMany({
    where: { status: 'CONFIRMED', deliveryDate: { gte: tomorrow, lt: dayAfter } },
    select: { id: true, code: true, farmerId: true, deliveryDate: true },
  });
  for (const o of orders) {
    await notifyUser(prisma, redis, o.farmerId, {
      template: 'harvest_reminder',
      link: { route: 'order', params: { id: o.id } },
      vars: { code: o.code, date: o.deliveryDate.toISOString().slice(0, 10), ussd: env.AT_USSD_CODE },
      type: 'reminder.harvest',
      data: { orderId: o.id },
      importance: 'normal',
    });
  }
  return orders.length;
}

/** Nudge buyers holding crates longer than the return window. */
export async function sendCrateReturnNudges(
  prisma: PrismaClient,
  redis: Redis,
  now = new Date(),
): Promise<number> {
  const days = await getSetting(prisma, 'crateReturnDays');
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const held = await prisma.crate.groupBy({
    by: ['holderOrgId'],
    where: { status: 'WITH_BUYER', holderOrgId: { not: null }, lastSeenAt: { lt: cutoff } },
    _count: { _all: true },
  });
  for (const h of held) {
    await notifyMany(prisma, redis, await orgContacts(prisma, h.holderOrgId!), {
      template: 'crate_return_reminder',
      link: { route: 'crates', params: {} },
      vars: { count: h._count._all },
      type: 'reminder.crates',
      data: { orgId: h.holderOrgId },
      importance: 'low',
    });
  }
  return held.length;
}
