import type { DeepLink } from '@farmgo/contracts';
import { channels, type Language } from '@farmgo/contracts';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import { isPhoneTempEmail } from '../phone-email.js';
import { enqueue } from '../queues.js';
import { publishRealtime } from '../realtime.js';
import { render, type TemplateKey } from './templates.js';

/**
 * high   = SMS always (money, new orders, OTP-like urgency)
 * normal = SMS only when the user has no app installed (feature-phone farmers)
 * low    = in-app and push only
 */
export type Importance = 'high' | 'normal' | 'low';

export interface NotifyArgs {
  template: TemplateKey;
  vars: Record<string, string | number>;
  type: string;
  data?: Record<string, unknown>;
  /** Required: where the notification opens in the app (merged into data as route + params). */
  link: DeepLink;
  importance?: Importance;
  /** Also send an email (buyers, invoices). */
  email?: boolean;
}

function inQuietHours(from: number | null, to: number | null, now = new Date()): boolean {
  if (from === null || to === null) return false;
  const h = (now.getUTCHours() + 3) % 24; // EAT
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/**
 * Deliver a notification to one user: saves it to their in-app inbox, pushes it live over
 * WebSocket, and queues push, SMS and email according to importance and their preferences.
 */
export async function notifyUser(
  prisma: PrismaClient,
  redis: Redis,
  userId: string,
  a: NotifyArgs,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { notificationPrefs: true, devices: { select: { id: true } } },
  });
  if (!user || user.banned) return;
  const lang = (user.preferredLanguage === 'en' ? 'en' : 'sw') as Language;
  const { title, body, sms } = render(a.template, lang, a.vars);
  const prefs = user.notificationPrefs;
  const importance = a.importance ?? 'normal';
  const quiet = importance !== 'high' && inQuietHours(prefs?.quietFrom ?? null, prefs?.quietTo ?? null);
  const hasApp = user.devices.length > 0;

  const sendPush = hasApp && (prefs?.push ?? true) && !quiet;
  const sendSms =
    !!user.phoneNumber &&
    (prefs?.sms ?? true) &&
    !quiet &&
    (importance === 'high' || (importance === 'normal' && !hasApp));
  const sendMail = !!a.email && (prefs?.email ?? true) && !isPhoneTempEmail(user.email);

  const channelsUsed = [
    'in_app',
    ...(sendPush ? ['push'] : []),
    ...(sendSms ? ['sms'] : []),
    ...(sendMail ? ['email'] : []),
  ];
  const data = { ...(a.data ?? {}), route: a.link.route, params: a.link.params };
  const notification = await prisma.notification.create({
    data: { userId, type: a.type, title, body, data, channels: channelsUsed },
  });

  await publishRealtime(redis, [channels.user(userId)], 'notification.new', {
    id: notification.id,
    type: a.type,
    title,
    body,
    data,
    createdAt: notification.createdAt.toISOString(),
  });
  if (sendPush)
    await enqueue('notify', 'push', {
      userId,
      title,
      body,
      data: { ...a.data, notificationId: notification.id },
    });
  if (sendSms)
    await enqueue('notify', 'sms', { to: user.phoneNumber!, message: sms, userId, kind: 'transactional' });
  if (sendMail) {
    await enqueue('notify', 'email', {
      to: user.email,
      subject: title,
      text: body,
      html: `<p>${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p style="color:#667">FarmGo Connect</p>`,
    });
  }
}

export async function notifyMany(prisma: PrismaClient, redis: Redis, userIds: string[], a: NotifyArgs) {
  for (const id of new Set(userIds)) await notifyUser(prisma, redis, id, a);
}

/** Owners and admins of an organization (procurement contacts for a hotel). */
export async function orgContacts(prisma: PrismaClient, orgId: string): Promise<string[]> {
  const members = await prisma.member.findMany({
    where: { organizationId: orgId },
    select: { userId: true, role: true },
  });
  const leads = members.filter((m) => m.role === 'owner' || m.role === 'admin');
  return (leads.length ? leads : members).map((m) => m.userId);
}

export async function usersWithRole(prisma: PrismaClient, role: string, county?: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role, banned: { not: true }, ...(county ? { county } : {}) },
    select: { id: true },
    take: 200,
  });
  return users.map((u) => u.id);
}
