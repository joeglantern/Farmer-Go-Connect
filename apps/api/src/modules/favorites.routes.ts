import {
  APP_CATEGORIES,
  ErrorBody,
  FavoriteDto,
  FavoriteInput,
  FavoriteListDto,
  FavoriteQuery,
  IdParams,
  Ok,
} from '@farmgo/contracts';
import { Errors, fileUrl } from '@farmgo/core';
import type { Favorite, FavoriteKind, PrismaClient } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/guards.js';
import { ok, typed } from '../lib/route.js';

/** Give each favorite a title, image and availability, looking targets up in bulk. */
export async function describeFavorites(prisma: PrismaClient, favs: Favorite[]) {
  const ids = (k: FavoriteKind) => favs.filter((f) => f.kind === k).map((f) => f.targetId);
  const [listings, farmers, produce] = await Promise.all([
    prisma.supplyListing.findMany({
      where: { id: { in: ids('LISTING') } },
      include: { produce: true, farm: { select: { name: true, photoKey: true } } },
    }),
    prisma.farmerProfile.findMany({
      where: { id: { in: ids('FARMER') } },
      include: {
        user: { select: { name: true, image: true, banned: true } },
        farms: { where: { active: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.produce.findMany({ where: { id: { in: ids('PRODUCE') } } }),
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const L = byId(listings);
  const F = byId(farmers);
  const P = byId(produce);
  const now = new Date();
  return favs.map((f) => {
    const base = { id: f.id, kind: f.kind, targetId: f.targetId, createdAt: f.createdAt };
    switch (f.kind) {
      case 'LISTING': {
        const l = L.get(f.targetId);
        return {
          ...base,
          title: l?.produce.name ?? 'Listing no longer available',
          titleSw: l?.produce.nameSw ?? null,
          subtitle: l?.farm.name ?? null,
          imageUrl: l ? fileUrl(l.photos[0] ?? l.produce.imageKey) : null,
          available: !!l && ['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) && l.availableTo >= now,
        };
      }
      case 'FARMER': {
        const p = F.get(f.targetId);
        const farm = p?.farms[0];
        return {
          ...base,
          title: p ? (p.user.name.split(' ')[0] ?? '') : 'Farmer no longer available',
          titleSw: null,
          subtitle: farm ? `${farm.name}, ${farm.county}` : null,
          imageUrl: p ? (fileUrl(farm?.photoKey) ?? fileUrl(p.user.image)) : null,
          available: !!p && !p.user.banned,
        };
      }
      case 'PRODUCE': {
        const p = P.get(f.targetId);
        return {
          ...base,
          title: p?.name ?? 'Produce no longer available',
          titleSw: p?.nameSw ?? null,
          subtitle: null,
          imageUrl: fileUrl(p?.imageKey),
          available: !!p?.active,
        };
      }
      default: {
        const c = APP_CATEGORIES.find((x) => x.slug === f.targetId);
        return {
          ...base,
          title: c?.name ?? f.targetId,
          titleSw: c?.nameSw ?? null,
          subtitle: null,
          // Category tiles use the app's bundled artwork.
          imageUrl: null,
          available: !!c,
        };
      }
    }
  });
}

/** Favorites (B12): listings, farmers, produce and categories a user starred. */
export default async function favoriteRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/favorites',
    {
      schema: {
        tags: ['me'],
        summary: 'My favorites, newest first',
        querystring: FavoriteQuery,
        response: ok(FavoriteListDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const favs = await app.prisma.favorite.findMany({
        where: { userId: user.id, ...(req.query.kind ? { kind: req.query.kind } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return describeFavorites(app.prisma, favs);
    },
  );

  r.post(
    '/v1/favorites',
    {
      schema: {
        tags: ['me'],
        summary: 'Add a favorite (adding one twice returns the existing one)',
        body: FavoriteInput,
        response: { 200: FavoriteDto, 201: FavoriteDto, default: ErrorBody },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { kind, targetId } = req.body;
      const exists =
        kind === 'LISTING'
          ? await app.prisma.supplyListing.count({ where: { id: targetId, status: { not: 'DRAFT' } } })
          : kind === 'FARMER'
            ? await app.prisma.farmerProfile.count({ where: { id: targetId } })
            : kind === 'PRODUCE'
              ? await app.prisma.produce.count({ where: { id: targetId } })
              : APP_CATEGORIES.some((c) => c.slug === targetId)
                ? 1
                : 0;
      if (!exists) throw Errors.notFound('Favorite target');
      const found = await app.prisma.favorite.findUnique({
        where: { userId_kind_targetId: { userId: user.id, kind, targetId } },
      });
      const fav = found ?? (await app.prisma.favorite.create({ data: { userId: user.id, kind, targetId } }));
      const [dto] = await describeFavorites(app.prisma, [fav]);
      return reply.status(found ? 200 : 201).send(dto!);
    },
  );

  r.delete(
    '/v1/favorites/:id',
    { schema: { tags: ['me'], summary: 'Remove a favorite', params: IdParams, response: ok(Ok) } },
    async (req) => {
      const user = requireUser(req);
      await app.prisma.favorite.deleteMany({ where: { id: req.params.id, userId: user.id } });
      return { ok: true as const };
    },
  );

  r.delete(
    '/v1/favorites',
    {
      schema: {
        tags: ['me'],
        summary: 'Remove a favorite by what it points at (?kind=&targetId=)',
        querystring: FavoriteInput,
        response: ok(Ok),
      },
    },
    async (req) => {
      const user = requireUser(req);
      await app.prisma.favorite.deleteMany({
        where: { userId: user.id, kind: req.query.kind, targetId: req.query.targetId },
      });
      return { ok: true as const };
    },
  );
}
