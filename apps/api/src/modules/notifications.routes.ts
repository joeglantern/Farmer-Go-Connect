import {
  DeepLink,
  DeviceTokenDto,
  MarkReadDto,
  MarkReadInput,
  NotificationPageDto,
  NotificationPrefsDto,
  NotificationPrefsInput,
  NotificationQuery,
  Ok,
  RegisterDeviceInput,
} from '@farmgo/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';

/** The deep link stored in a notification's data, if it has a valid one. */
function linkOf(data: unknown) {
  const parsed = DeepLink.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export default async function notificationRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/notifications',
    {
      schema: {
        tags: ['notifications'],
        summary: 'In-app inbox',
        querystring: NotificationQuery,
        response: ok(NotificationPageDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const rows = await app.prisma.notification.findMany({
        where: { userId: user.id, ...(req.query.unreadOnly ? { readAt: null } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      const unread = await app.prisma.notification.count({ where: { userId: user.id, readAt: null } });
      const page = paginate(rows, req.query.limit);
      return { ...page, items: page.items.map((n) => ({ ...n, link: linkOf(n.data) })), unread };
    },
  );

  r.post(
    '/v1/notifications/read',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Mark some or all as read',
        body: MarkReadInput,
        response: ok(MarkReadDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const res = await app.prisma.notification.updateMany({
        where: { userId: user.id, readAt: null, ...(req.body.all ? {} : { id: { in: req.body.ids ?? [] } }) },
        data: { readAt: new Date() },
      });
      return { updated: res.count };
    },
  );

  r.get(
    '/v1/notifications/preferences',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Channel preferences and quiet hours',
        response: ok(NotificationPrefsDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      return (
        (await app.prisma.notificationPreference.findUnique({ where: { userId: user.id } })) ?? {
          userId: user.id,
          sms: true,
          push: true,
          email: true,
          quietFrom: null,
          quietTo: null,
        }
      );
    },
  );

  r.patch(
    '/v1/notifications/preferences',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Update channel preferences and quiet hours',
        body: NotificationPrefsInput,
        response: ok(NotificationPrefsDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      return app.prisma.notificationPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...req.body },
        update: req.body,
      });
    },
  );

  r.post(
    '/v1/devices',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Register this device for push notifications',
        body: RegisterDeviceInput,
        response: created(DeviceTokenDto),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      // A token moves to whoever signed in last on that device.
      const d = await app.prisma.deviceToken.upsert({
        where: { token: req.body.token },
        create: { userId: user.id, token: req.body.token, platform: req.body.platform },
        update: { userId: user.id, platform: req.body.platform, lastSeenAt: new Date() },
      });
      return reply.status(201).send(d);
    },
  );

  r.delete(
    '/v1/devices/:token',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Unregister on sign-out',
        params: z.object({ token: z.string().max(300) }),
        response: ok(Ok),
      },
    },
    async (req) => {
      const user = requireUser(req);
      await app.prisma.deviceToken.deleteMany({ where: { token: req.params.token, userId: user.id } });
      return { ok: true as const };
    },
  );
}
