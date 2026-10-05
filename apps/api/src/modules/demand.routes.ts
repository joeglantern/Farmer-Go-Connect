import {
  CreateDemandInput,
  DemandBoardDto,
  DemandBoardQuery,
  DemandDetailDto,
  DemandPageDto,
  DemandQuery,
  DemandWithProduceDto,
  IdParams,
  UpdateDemandInput,
} from '@farmgo/contracts';
import {
  assertNotPast,
  demandBoard,
  Errors,
  emit,
  enqueue,
  expandRecurringDemand,
  occurrences,
} from '@farmgo/core';
import { type DemandStatus, num, type Prisma } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { requireOrg, requirePermission, requireUser } from '../lib/guards.js';
import { cursorArgs, LIST_CAP, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';

export default async function demandRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/demand',
    {
      schema: {
        tags: ['demand'],
        summary: "My organization's requirements",
        querystring: DemandQuery,
        response: ok(DemandPageDto),
      },
    },
    async (req) => {
      requirePermission(req, { demand: ['read'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const q = req.query;
      const where: Prisma.DemandRequestWhereInput = {
        buyerOrgId: orgId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.produceId ? { produceId: q.produceId } : {}),
        ...(q.recurringOnly ? { recurrence: { not: null }, parentId: null } : {}),
      };
      const rows = await app.prisma.demandRequest.findMany({
        where,
        include: { produce: true, _count: { select: { matches: true, children: true } } },
        orderBy: [{ neededBy: 'asc' }, { id: 'asc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.get(
    '/v1/demand/board',
    {
      schema: {
        tags: ['demand'],
        summary: 'What buyers need, by produce, county and week (anonymised)',
        querystring: DemandBoardQuery,
        response: ok(DemandBoardDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { demand: ['board'] });
      if (!req.query.mine) return demandBoard(app.prisma, req.query);
      // A farmer's view: demand for produce they have on offer, with the listings that could fill it.
      const listings = await app.prisma.supplyListing.findMany({
        where: {
          farm: { farmer: { userId: user.id }, active: true },
          status: { in: ['OPEN', 'PARTIALLY_MATCHED'] },
          availableTo: { gte: new Date() },
          quantityLeft: { gt: 0 },
          ...(req.query.produceId ? { produceId: req.query.produceId } : {}),
        },
        select: { id: true, produceId: true, availableFrom: true, availableTo: true },
        orderBy: { availableFrom: 'asc' },
        take: LIST_CAP.ownListings,
      });
      if (!listings.length) return [];
      const rows = await demandBoard(app.prisma, req.query);
      const DAY = 86_400_000;
      return rows
        .filter((row) => listings.some((l) => l.produceId === row.produceId))
        .map((row) => {
          const weekStart = new Date(`${row.week}T00:00:00Z`).getTime();
          const fits = listings.filter(
            (l) =>
              l.produceId === row.produceId &&
              l.availableFrom.getTime() <= weekStart + 7 * DAY &&
              l.availableTo.getTime() >= weekStart,
          );
          return { ...row, listingIds: fits.map((l) => l.id) };
        })
        .filter((row) => row.listingIds.length > 0);
    },
  );

  r.get(
    '/v1/demand/:id',
    {
      schema: {
        tags: ['demand'],
        summary: 'One requirement with its matches and upcoming dates',
        params: IdParams,
        response: ok(DemandDetailDto),
      },
    },
    async (req) => {
      requireUser(req);
      const { orgId } = await requireOrg(req, 'BUYER');
      const d = await app.prisma.demandRequest.findUnique({
        where: { id: req.params.id },
        include: {
          produce: true,
          children: { orderBy: { neededBy: 'asc' }, take: 20 },
          matches: {
            include: { listing: { include: { farm: { select: { name: true, county: true, ward: true } } } } },
            orderBy: { score: 'desc' },
          },
        },
      });
      if (!d || d.buyerOrgId !== orgId) throw Errors.notFound('Demand');
      const upcoming = d.recurrence
        ? occurrences(
            d.recurrence,
            d.neededBy,
            new Date(),
            new Date(Date.now() + 60 * 86_400_000),
            d.recurrenceUntil,
          ).slice(0, 8)
        : [];
      return { ...d, upcomingDates: upcoming };
    },
  );

  r.post(
    '/v1/demand',
    {
      schema: {
        tags: ['demand'],
        summary: 'Post a one-off or recurring requirement',
        body: CreateDemandInput,
        response: created(DemandWithProduceDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { demand: ['create'] });
      const { orgId, profile } = await requireOrg(req, 'BUYER');
      const b = req.body;
      assertNotPast(b.neededBy, 'neededBy');
      const produce = await app.prisma.produce.findUnique({ where: { id: b.produceId } });
      if (!produce?.active) throw Errors.badRequest('UNKNOWN_PRODUCE', 'Choose produce from the catalog');
      if (b.minGrade && !produce.grades.includes(b.minGrade)) {
        throw Errors.badRequest('INVALID_GRADE', `Grade must be one of ${produce.grades.join(', ')}`);
      }
      if (b.recurrence) {
        try {
          occurrences(b.recurrence, b.neededBy, b.neededBy, new Date(b.neededBy.getTime() + 86_400_000));
        } catch {
          throw Errors.badRequest('INVALID_RECURRENCE', 'The recurrence rule could not be read');
        }
      }
      const demand = await app.prisma.$transaction(async (tx) => {
        const d = await tx.demandRequest.create({
          data: {
            buyerOrgId: orgId,
            createdById: user.id,
            produceId: b.produceId,
            quantity: b.quantity,
            minGrade: b.minGrade,
            maxPricePerUnit: b.maxPricePerUnit,
            neededBy: b.neededBy,
            recurrence: b.recurrence,
            recurrenceUntil: b.recurrenceUntil,
            county: b.county ?? profile.county,
            deliveryLat: b.deliveryLat ?? profile.lat,
            deliveryLng: b.deliveryLng ?? profile.lng,
            notes: b.notes,
          },
          include: { produce: true },
        });
        await emit(
          tx,
          'demand.created',
          { demandId: d.id, buyerOrgId: orgId, produceId: d.produceId, county: d.county },
          d.id,
        );
        return d;
      });
      // Recurring templates spawn their upcoming instances right away (the daily job keeps them topped up).
      if (demand.recurrence) await expandRecurringDemand(app.prisma);
      return reply.status(201).send(demand);
    },
  );

  r.patch(
    '/v1/demand/:id',
    {
      schema: {
        tags: ['demand'],
        summary: 'Edit or cancel a requirement',
        params: IdParams,
        body: UpdateDemandInput,
        response: ok(DemandWithProduceDto),
      },
    },
    async (req) => {
      requirePermission(req, { demand: ['update'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      return app.prisma.$transaction(async (tx) => {
        const d = await tx.demandRequest.findUnique({ where: { id: req.params.id } });
        if (!d || d.buyerOrgId !== orgId) throw Errors.notFound('Demand');
        if (['FILLED', 'EXPIRED', 'CANCELLED'].includes(d.status)) {
          throw Errors.conflict('DEMAND_CLOSED', `This requirement is ${d.status.toLowerCase()}`);
        }
        const { status: requested, ...fields } = req.body;
        if (fields.neededBy) assertNotPast(fields.neededBy, 'neededBy');
        const future = { parentId: d.id, neededBy: { gt: new Date() } };
        let status: DemandStatus | undefined;
        if (requested === 'PAUSED') {
          if (d.status === 'PAUSED')
            throw Errors.conflict('DEMAND_ALREADY_PAUSED', 'This requirement is already paused');
          status = 'PAUSED';
          // Out of matching: remove pending proposals (not rejections, so the same farms can be
          // proposed again after a resume); a recurring template pauses its upcoming dates too.
          await tx.match.deleteMany({ where: { demandId: d.id, status: 'PROPOSED' } });
          if (!d.parentId && d.recurrence) {
            await tx.match.deleteMany({
              where: {
                status: 'PROPOSED',
                demand: { ...future, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
              },
            });
            await tx.demandRequest.updateMany({
              where: { ...future, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
              data: { status: 'PAUSED' },
            });
          }
        } else if (requested === 'OPEN') {
          if (d.status !== 'PAUSED')
            throw Errors.conflict('DEMAND_NOT_PAUSED', 'Only a paused requirement can be resumed');
          status = num(d.quantityFilled) > 0 ? 'PARTIALLY_FILLED' : 'OPEN';
          if (!d.parentId && d.recurrence) {
            await tx.demandRequest.updateMany({
              where: { ...future, status: 'PAUSED' },
              data: { status: 'OPEN' },
            });
          }
        } else if (requested === 'CANCELLED') {
          status = 'CANCELLED';
        }
        const updated = await tx.demandRequest.update({
          where: { id: d.id },
          data: { ...fields, ...(status ? { status } : {}) },
          include: { produce: true },
        });
        if (requested === 'OPEN') {
          // Back in matching: look for supply again now rather than at the next listing.
          const resumed = [
            d.id,
            ...(
              await tx.demandRequest.findMany({ where: { ...future, status: 'OPEN' }, select: { id: true } })
            ).map((c) => c.id),
          ];
          for (const demandId of resumed) {
            await enqueue(
              'matching',
              'match-demand',
              { demandId },
              { jobId: `md-resume-${demandId}-${Date.now()}` },
            );
          }
        }
        if (requested === 'CANCELLED') {
          await tx.match.updateMany({
            where: { demandId: d.id, status: 'PROPOSED' },
            data: { status: 'REJECTED' },
          });
          if (!d.parentId && d.recurrence) {
            // Cancelling a recurring template also cancels its future open or paused instances.
            await tx.demandRequest.updateMany({
              where: { parentId: d.id, status: { in: ['OPEN', 'PAUSED'] }, neededBy: { gt: new Date() } },
              data: { status: 'CANCELLED' },
            });
          }
          await emit(tx, 'demand.cancelled', { demandId: d.id, buyerOrgId: orgId }, d.id);
        } else {
          await emit(tx, 'demand.updated', { demandId: d.id, buyerOrgId: orgId }, d.id);
        }
        return updated;
      });
    },
  );
}
