import { BadgesDto, ConversationListDto, ErrorBody, IdParams } from '@farmgo/contracts';
import { fileUrl } from '@farmgo/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/guards.js';
import { ok, typed } from '../lib/route.js';
import { loadOrder, orderScope } from './order-access.js';

const MAX_THREADS = 100;

/**
 * The Messages tab (B11): one conversation per order, newest activity first, with unread counts
 * per user (every member of a buyer organization reads on their own).
 */
export default async function conversationRoutes(app: FastifyInstance) {
  const r = typed(app);

  /** Threads the caller can see, with last message and unread count, newest activity first. */
  async function conversations(req: FastifyRequest) {
    const user = requireUser(req);
    const scope = await orderScope(req);
    // Candidates: orders changed recently, and orders with recent messages (a message does not
    // touch the order row, so a quiet order can still have a fresh thread).
    const [recentOrders, recentMessages] = await Promise.all([
      app.prisma.order.findMany({
        where: scope,
        orderBy: { updatedAt: 'desc' },
        take: MAX_THREADS,
        select: { id: true },
      }),
      app.prisma.orderMessage.findMany({
        where: { order: scope },
        orderBy: { createdAt: 'desc' },
        distinct: ['orderId'],
        take: MAX_THREADS,
        select: { orderId: true },
      }),
    ]);
    const ids = [...new Set([...recentOrders.map((o) => o.id), ...recentMessages.map((m) => m.orderId)])];
    if (ids.length === 0) return [];

    const [orders, unread] = await Promise.all([
      app.prisma.order.findMany({
        where: { id: { in: ids } },
        include: {
          buyerOrg: { select: { id: true, name: true, logo: true } },
          farmer: { select: { id: true, name: true, image: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      app.prisma.$queryRawUnsafe<{ orderId: string; n: number }[]>(
        `SELECT m."orderId", COUNT(*)::int AS n
           FROM "OrderMessage" m
           LEFT JOIN "ConversationRead" r ON r."orderId" = m."orderId" AND r."userId" = $1
          WHERE m."orderId" = ANY($2::text[])
            AND m."authorId" <> $1
            AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
            -- A colleague in the caller's own buyer organization is "us", not someone to read.
            AND NOT EXISTS (
              SELECT 1 FROM "Order" o
                JOIN "member" author ON author."organizationId" = o."buyerOrgId" AND author."userId" = m."authorId"
                JOIN "member" me ON me."organizationId" = o."buyerOrgId" AND me."userId" = $1
               WHERE o.id = m."orderId"
            )
          GROUP BY m."orderId"`,
        user.id,
        ids,
      ),
    ]);
    const unreadByOrder = new Map(unread.map((u) => [u.orderId, u.n]));
    const isBuyerSide = async (buyerOrgId: string) =>
      !!(await app.prisma.member.findFirst({ where: { organizationId: buyerOrgId, userId: user.id } }));

    const threads = [];
    for (const o of orders) {
      const last = o.messages[0] ?? null;
      const buyerViewer = o.farmerId !== user.id && (await isBuyerSide(o.buyerOrgId));
      threads.push({
        orderId: o.id,
        orderCode: o.code,
        orderStatus: o.status,
        other: buyerViewer
          ? { id: o.farmer.id, name: o.farmer.name, avatarUrl: fileUrl(o.farmer.image), role: 'farmer' }
          : { id: o.buyerOrg.id, name: o.buyerOrg.name, avatarUrl: fileUrl(o.buyerOrg.logo), role: 'buyer' },
        lastMessage: last
          ? {
              body: last.body,
              authorId: last.authorId,
              createdAt: last.createdAt,
              hasPhotos: last.photos.length > 0,
            }
          : null,
        unreadCount: unreadByOrder.get(o.id) ?? 0,
        updatedAt: last && last.createdAt > o.updatedAt ? last.createdAt : o.updatedAt,
      });
    }
    return threads.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, MAX_THREADS);
  }

  r.get(
    '/v1/conversations',
    {
      schema: {
        tags: ['orders'],
        summary: 'Message threads (one per order), newest activity first, with unread counts',
        response: ok(ConversationListDto),
      },
    },
    async (req) => conversations(req),
  );

  r.post(
    '/v1/orders/:id/messages/read',
    {
      schema: {
        tags: ['orders'],
        summary: "Mark this order's messages as read for me",
        params: IdParams,
        response: { 204: z.null().describe('Marked as read'), default: ErrorBody },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { order } = await loadOrder(req, req.params.id);
      const now = new Date();
      await app.prisma.conversationRead.upsert({
        where: { orderId_userId: { orderId: order.id, userId: user.id } },
        create: { orderId: order.id, userId: user.id, lastReadAt: now },
        update: { lastReadAt: now },
      });
      return reply.status(204).send(null);
    },
  );

  r.get(
    '/v1/me/badges',
    {
      schema: {
        tags: ['me'],
        summary: 'Unread counts for the app badges (notifications, messages)',
        response: ok(BadgesDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const [notificationsUnread, threads] = await Promise.all([
        app.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
        // Accounts without an order side yet (fresh sign-ups) simply have no threads.
        conversations(req).catch(() => []),
      ]);
      return {
        notificationsUnread,
        messagesUnread: threads.reduce((s, t) => s + t.unreadCount, 0),
      };
    },
  );
}
