import {
  CreateListingInput,
  HarvestReadyDto,
  IdParams,
  ListingDetailDto,
  ListingPageDto,
  ListingQuery,
  OwnListingDto,
  UpdateListingInput,
} from '@farmgo/contracts';
import { AppError, Errors, haversineKm, pointOrCentroid } from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isAdmin, requireFarmer, requireRole, requireUser, roleOf } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';
import { loadManageableFarm } from './farms.routes.js';
import { searchListingIds, searchOrigin } from './supply.search.js';
import {
  createListing,
  markHarvestReady,
  publicListingInclude,
  undoHarvestReady,
  updateListing,
} from './supply.service.js';
import { assertOwnKeys } from './uploads.routes.js';

/** Farmer names are shown by first name only to buyers. */
function redactListing<T extends { farm: { farmer: { user: { name: string } } } }>(l: T): T {
  const first = l.farm.farmer.user.name.split(' ')[0] ?? '';
  return { ...l, farm: { ...l.farm, farmer: { ...l.farm.farmer, user: { name: first } } } };
}

/**
 * A listing the caller may manage. Who is asking is checked before anything is looked up, and a
 * listing that exists but is not theirs reads exactly like one that does not exist.
 */
async function manageableListing(req: FastifyRequest, id: string) {
  requireRole(req, 'farmer', 'agent');
  const listing = await req.server.prisma.supplyListing.findUnique({ where: { id } });
  if (!listing) throw Errors.notFound('Listing');
  try {
    await loadManageableFarm(req, listing.farmId);
  } catch (err) {
    if (err instanceof AppError && err.httpStatus === 404) throw Errors.notFound('Listing');
    throw err;
  }
  return listing;
}

export default async function supplyRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/supply',
    {
      schema: {
        tags: ['supply'],
        summary: 'Browse available and upcoming produce',
        querystring: ListingQuery,
        response: ok(ListingPageDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const q = req.query;
      if (!q.mine) {
        // Buyers' browse and search (B05): filters, text search, sort and distance in one query.
        const origin = await searchOrigin(app.prisma, user.id, q);
        const statuses = q.status && isAdmin(user) ? [q.status] : ['OPEN', 'PARTIALLY_MATCHED'];
        const { rows, nextCursor } = await searchListingIds(app.prisma, q, { origin, statuses });
        const found = await app.prisma.supplyListing.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: publicListingInclude,
        });
        const byId = new Map(found.map((l) => [l.id, l]));
        const items = rows
          .map((r) => {
            const l = byId.get(r.id);
            return l ? { ...(isAdmin(user) ? l : redactListing(l)), distanceKm: r.km } : null;
          })
          .filter((l): l is NonNullable<typeof l> => l !== null);
        return { items, nextCursor };
      }
      const now = new Date();
      // Date filters combine (QA-017): the listing's window must overlap [from, to]; `upcoming`
      // means it has not started yet; buyers only see listings that have not ended.
      const endsAfter = [q.from, q.mine ? undefined : now].filter((d): d is Date => !!d);
      const where: Prisma.SupplyListingWhereInput = {
        ...(q.produceId ? { produceId: q.produceId } : {}),
        ...(q.county ? { farm: { county: q.county } } : {}),
        AND: [
          ...(q.to ? [{ availableFrom: { lte: q.to } }] : []),
          ...(q.upcoming ? [{ availableFrom: { gt: now } }] : []),
          ...endsAfter.map((d) => ({ availableTo: { gte: d } })),
        ],
      };
      if (q.mine) {
        const { profile } = await requireFarmer(req);
        where.farm = { ...(where.farm as object), farmerId: profile.id };
        if (q.status) where.status = q.status;
      } else {
        where.status = q.status && isAdmin(user) ? q.status : { in: ['OPEN', 'PARTIALLY_MATCHED'] };
      }
      const rows = await app.prisma.supplyListing.findMany({
        where,
        include: publicListingInclude,
        orderBy: [{ availableFrom: 'asc' }, { id: 'asc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      const pageData = paginate(rows, q.limit);
      return {
        ...pageData,
        items: q.mine || isAdmin(user) ? pageData.items : pageData.items.map(redactListing),
      };
    },
  );

  r.get(
    '/v1/supply/:id',
    {
      schema: {
        tags: ['supply'],
        summary: 'One listing, with similar listings, the price index, distance and tags',
        params: IdParams,
        response: ok(ListingDetailDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const listing = await app.prisma.supplyListing.findUnique({
        where: { id: req.params.id },
        include: publicListingInclude,
      });
      if (!listing) throw Errors.notFound('Listing');
      const owner = await app.prisma.farm.findFirst({
        where: { id: listing.farmId, farmer: { userId: user.id } },
      });
      // Drafts are hidden from the list, so they are hidden by id too (QA-031): only the farmer,
      // their onboarding agent and admins see them.
      if (listing.status === 'DRAFT' && !owner && !isAdmin(user)) {
        const agent =
          roleOf(user) === 'agent' &&
          (await app.prisma.farm.count({
            where: { id: listing.farmId, farmer: { onboardedById: user.id } },
          })) > 0;
        if (!agent) throw Errors.notFound('Listing');
      }
      const shown = owner || isAdmin(user) ? listing : redactListing(listing);

      const origin = await searchOrigin(app.prisma, user.id, {});
      const farm = await app.prisma.farm.findUniqueOrThrow({
        where: { id: listing.farmId },
        select: { lat: true, lng: true, county: true },
      });
      const farmPoint = pointOrCentroid(farm, farm.county);
      const distanceKm = origin && farmPoint ? Math.round(haversineKm(origin, farmPoint) * 10) / 10 : null;

      // Similar: same produce, open, nearest first when we know where the buyer is.
      const { rows } = await searchListingIds(
        app.prisma,
        { produceId: listing.produceId, limit: 7, sort: origin ? 'nearest' : 'soonest' } as ListingQuery,
        { origin, statuses: ['OPEN', 'PARTIALLY_MATCHED'] },
      );
      const others = rows.filter((r) => r.id !== listing.id).slice(0, 6);
      const found = await app.prisma.supplyListing.findMany({
        where: { id: { in: others.map((r) => r.id) } },
        include: publicListingInclude,
      });
      const byId = new Map(found.map((l) => [l.id, l]));
      const similar = others
        .map((r) => {
          const l = byId.get(r.id);
          return l ? { ...(isAdmin(user) ? l : redactListing(l)), distanceKm: r.km } : null;
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);

      // Price index for the buyer's county, else the farm's, else any county.
      const buyerProfile = await app.prisma.orgProfile.findFirst({
        where: { type: 'BUYER', organization: { members: { some: { userId: user.id } } } },
        select: { county: true },
      });
      const counties = [buyerProfile?.county, farm.county].filter((c): c is string => !!c);
      let point = null;
      for (const county of counties) {
        point = await app.prisma.pricePoint.findFirst({
          where: { produceId: listing.produceId, county },
          orderBy: { week: 'desc' },
        });
        if (point) break;
      }
      point ??= await app.prisma.pricePoint.findFirst({
        where: { produceId: listing.produceId },
        orderBy: { week: 'desc' },
      });
      const priceIndex = point
        ? {
            county: point.county,
            week: point.week.toISOString().slice(0, 10),
            avgPrice: point.avgPrice,
            diffPct: Math.round(((listing.pricePerUnit - point.avgPrice) / point.avgPrice) * 1000) / 10,
          }
        : null;

      const now = Date.now();
      const DAY = 86_400_000;
      const from = listing.availableFrom.getTime();
      const tags: ('fresh' | 'organic' | 'local')[] = [];
      if ((from <= now && from >= now - 3 * DAY) || (from > now && from <= now + 7 * DAY)) tags.push('fresh');
      if (listing.farm.isOrganic) tags.push('organic');
      if (distanceKm !== null && distanceKm <= 30) tags.push('local');

      return { ...shown, distanceKm, similar, priceIndex, tags };
    },
  );

  r.post(
    '/v1/supply',
    {
      schema: {
        tags: ['supply'],
        summary: 'List produce (available now or upcoming harvest)',
        body: CreateListingInput,
        response: created(OwnListingDto),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const role = roleOf(user);
      if (!['farmer', 'agent', 'admin'].includes(role))
        throw Errors.forbidden('Only farmers can list produce');
      const farm = await loadManageableFarm(req, req.body.farmId);
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const listing = await createListing(app.prisma, farm, req.body);
      return reply.status(201).send(listing);
    },
  );

  r.patch(
    '/v1/supply/:id',
    {
      schema: {
        tags: ['supply'],
        summary: 'Edit a listing (quantity, price, window, status)',
        params: IdParams,
        body: UpdateListingInput,
        response: ok(OwnListingDto),
      },
    },
    async (req) => {
      const listing = await app.prisma.supplyListing.findUnique({ where: { id: req.params.id } });
      if (!listing) throw Errors.notFound('Listing');
      const farm = await loadManageableFarm(req, listing.farmId);
      if (req.body.photos?.length) await assertOwnKeys(req, req.body.photos);
      return updateListing(app.prisma, listing.id, farm.farmer.userId, req.body);
    },
  );

  r.delete(
    '/v1/supply/:id/harvest-ready',
    {
      schema: {
        tags: ['supply'],
        summary: 'Undo "harvest ready" (only before any order has gone to inspection)',
        params: IdParams,
        response: ok(OwnListingDto),
      },
    },
    async (req) => {
      const listing = await manageableListing(req, req.params.id);
      const user = requireUser(req);
      return undoHarvestReady(app.prisma, listing.id, user.id, isAdmin(user) ? 'admin' : 'farmer');
    },
  );

  r.post(
    '/v1/supply/:id/harvest-ready',
    {
      schema: {
        tags: ['supply'],
        summary: 'Report the harvest is in; confirmed orders go to inspection',
        params: IdParams,
        response: ok(HarvestReadyDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const listing = await manageableListing(req, req.params.id);
      return markHarvestReady(app.prisma, listing.id, user.id, isAdmin(user) ? 'admin' : 'farmer');
    },
  );
}
