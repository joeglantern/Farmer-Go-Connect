import { IdParams, MatchAcceptDto, MatchPageDto, MatchQuery, Ok } from '@farmgo/contracts';
import { acceptMatch, Errors, rejectMatch } from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isAdmin, requirePermission, roleOf } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { ok, typed } from '../lib/route.js';

/** Which side of the match the caller is on. */
async function matchSide(req: FastifyRequest, matchId: string) {
  const user = requirePermission(req, { match: ['respond'] });
  const m = await req.server.prisma.match.findUnique({
    where: { id: matchId },
    include: { demand: true, listing: { include: { farm: { include: { farmer: true } } } } },
  });
  if (!m) throw Errors.notFound('Match');
  if (m.listing.farm.farmer.userId === user.id) return { user, match: m, side: 'farmer' as const };
  const member = await req.server.prisma.member.findFirst({
    where: { organizationId: m.demand.buyerOrgId, userId: user.id },
  });
  if (member) return { user, match: m, side: 'buyer' as const };
  throw Errors.notFound('Match');
}

export default async function matchRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/matches',
    {
      schema: {
        tags: ['matches'],
        summary: 'Proposed and past matches for me or my organization',
        querystring: MatchQuery,
        response: ok(MatchPageDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { match: ['read'] });
      const q = req.query;
      let scope: Prisma.MatchWhereInput;
      if (isAdmin(user)) scope = {};
      else if (roleOf(user) === 'farmer') scope = { listing: { farm: { farmer: { userId: user.id } } } };
      else {
        const orgIds = (
          await app.prisma.member.findMany({ where: { userId: user.id }, select: { organizationId: true } })
        ).map((m) => m.organizationId);
        scope = { demand: { buyerOrgId: { in: orgIds } } };
      }
      const rows = await app.prisma.match.findMany({
        where: {
          ...scope,
          ...(q.status ? { status: q.status } : {}),
          ...(q.demandId ? { demandId: q.demandId } : {}),
          ...(q.listingId ? { listingId: q.listingId } : {}),
        },
        include: {
          demand: { include: { produce: true } },
          listing: {
            include: { farm: { select: { name: true, county: true, ward: true, isOrganic: true } } },
          },
          orderItem: { select: { orderId: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.post(
    '/v1/matches/:id/accept',
    {
      schema: {
        tags: ['matches'],
        summary: 'Accept a proposed match; the order is created once both sides accept',
        params: IdParams,
        response: ok(MatchAcceptDto),
      },
    },
    async (req) => {
      const { user, match, side } = await matchSide(req, req.params.id);
      const result = await app.prisma.$transaction((tx) => acceptMatch(tx, match.id, side, user.id));
      const updated = await app.prisma.match.findUnique({ where: { id: match.id } });
      return {
        match: updated,
        orderId: result.orderId ?? null,
        waitingFor: result.orderId ? null : side === 'buyer' ? ('farmer' as const) : ('buyer' as const),
      };
    },
  );

  r.post(
    '/v1/matches/:id/reject',
    {
      schema: { tags: ['matches'], summary: 'Decline a proposed match', params: IdParams, response: ok(Ok) },
    },
    async (req) => {
      const { match, side } = await matchSide(req, req.params.id);
      await app.prisma.$transaction((tx) => rejectMatch(tx, match.id, side));
      return { ok: true as const };
    },
  );
}
