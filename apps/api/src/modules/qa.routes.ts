import {
  IdParams,
  InspectionDetailDto,
  InspectionInput,
  InspectionResultDto,
  ListingCheckInput,
  OwnListingDto,
  QaListingTaskListDto,
  QaTaskListDto,
  QaTaskQuery,
} from '@farmgo/contracts';
import { audit, Errors, emit, recordInspection } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { isAdmin, requirePermission } from '../lib/guards.js';
import { created, ok, typed } from '../lib/route.js';
import type { SessionUser } from '../types.js';
import { assertOwnKeys } from './uploads.routes.js';

/** The farm fields a QA officer needs to find the farm and call the farmer. */
const qaFarmSelect = {
  id: true,
  name: true,
  county: true,
  ward: true,
  lat: true,
  lng: true,
  farmer: { select: { user: { select: { name: true, phoneNumber: true } } } },
} as const;

/** `all` covers every county; omitted means the officer's own county (admins: all). */
function qaCounty(user: SessionUser, asked?: string) {
  if (asked === 'all') return undefined;
  return asked ?? (isAdmin(user) ? undefined : ((user as { county?: string | null }).county ?? undefined));
}

export default async function qaRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/qa/listings',
    {
      schema: {
        tags: ['qa'],
        summary: 'New listings waiting for their quality check at the farm (oldest first)',
        querystring: QaTaskQuery,
        response: ok(QaListingTaskListDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { qa: ['read'] });
      const county = qaCounty(user, req.query.county);
      return app.prisma.supplyListing.findMany({
        where: { status: 'PENDING_QA', ...(county ? { farm: { county } } : {}) },
        include: { produce: true, farm: { select: qaFarmSelect } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
    },
  );

  r.post(
    '/v1/qa/listings/:id/check',
    {
      schema: {
        tags: ['qa'],
        summary: 'Approve a new listing (buyers can then see it) or send it back to the farmer',
        params: IdParams,
        body: ListingCheckInput,
        response: ok(OwnListingDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { qa: ['inspect'] });
      const body = req.body;
      if (body.photos.length) await assertOwnKeys(req, body.photos);
      return app.prisma.$transaction(async (tx) => {
        const listing = await tx.supplyListing.findUnique({
          where: { id: req.params.id },
          include: { produce: true, farm: { include: { farmer: { select: { userId: true } } } } },
        });
        if (!listing) throw Errors.notFound('Listing');
        if (listing.status !== 'PENDING_QA') {
          throw Errors.conflict('LISTING_NOT_PENDING', 'This listing is not waiting for a quality check');
        }
        if (body.passed && body.grade && !listing.produce.grades.includes(body.grade)) {
          throw Errors.badRequest(
            'INVALID_GRADE',
            `Grade must be one of ${listing.produce.grades.join(', ')}`,
          );
        }
        // Claim the check atomically so two officers cannot both decide.
        const claimed = await tx.supplyListing.updateMany({
          where: { id: listing.id, status: 'PENDING_QA' },
          data: body.passed
            ? {
                status: 'OPEN',
                ...(body.grade ? { grade: body.grade } : {}),
                qaApprovedAt: new Date(),
                qaCheckedById: user.id,
                qaNote: body.note ?? null,
                qaPhotos: body.photos,
              }
            : {
                status: 'QA_REJECTED',
                qaCheckedById: user.id,
                qaNote: body.note ?? null,
                qaPhotos: body.photos,
              },
        });
        if (claimed.count !== 1) {
          throw Errors.conflict('LISTING_NOT_PENDING', 'This listing is not waiting for a quality check');
        }
        const updated = await tx.supplyListing.findUniqueOrThrow({
          where: { id: listing.id },
          include: { produce: true },
        });
        const farmerUserId = listing.farm.farmer.userId;
        if (body.passed) {
          await emit(
            tx,
            'supply.created',
            {
              listingId: listing.id,
              farmerUserId,
              produceId: listing.produceId,
              county: listing.farm.county,
            },
            listing.id,
          );
        }
        await emit(
          tx,
          'supply.qa_checked',
          { listingId: listing.id, farmerUserId, passed: body.passed, produceName: listing.produce.name },
          listing.id,
        );
        await audit(tx, {
          actorId: user.id,
          action: body.passed ? 'listing.qa_approve' : 'listing.qa_reject',
          entity: 'SupplyListing',
          entityId: listing.id,
          before: { status: listing.status, grade: listing.grade },
          after: {
            status: updated.status,
            grade: updated.grade,
            note: updated.qaNote,
            photos: updated.qaPhotos,
          },
          ip: req.ip,
        });
        return updated;
      });
    },
  );

  r.get(
    '/v1/qa/tasks',
    {
      schema: {
        tags: ['qa'],
        summary: 'Orders waiting for inspection',
        querystring: QaTaskQuery,
        response: ok(QaTaskListDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { qa: ['read'] });
      const county = qaCounty(user, req.query.county);
      return app.prisma.order.findMany({
        where: {
          status: 'READY_FOR_QA',
          ...(county ? { items: { some: { listing: { farm: { county } } } } } : {}),
        },
        include: {
          items: {
            include: {
              inspection: true,
              listing: {
                include: {
                  produce: true,
                  farm: { select: qaFarmSelect },
                },
              },
            },
          },
          buyerOrg: { select: { name: true } },
        },
        orderBy: { deliveryDate: 'asc' },
        take: 100,
      });
    },
  );

  r.post(
    '/v1/qa/inspections',
    {
      schema: {
        tags: ['qa'],
        summary: 'Record an inspection for one order item',
        body: InspectionInput,
        response: created(InspectionResultDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { qa: ['inspect'] });
      if (req.body.photos.length) await assertOwnKeys(req, req.body.photos);
      const result = await app.prisma.$transaction((tx) =>
        recordInspection(tx, req.body, user.id, isAdmin(user) ? 'admin' : 'qa'),
      );
      return reply.status(201).send(result);
    },
  );

  r.get(
    '/v1/qa/inspections/:id',
    {
      schema: {
        tags: ['qa'],
        summary: 'One inspection with its order item and inspector',
        params: IdParams,
        response: ok(InspectionDetailDto),
      },
    },
    async (req) => {
      requirePermission(req, { qa: ['read'] });
      const insp = await app.prisma.qualityInspection.findUnique({
        where: { id: req.params.id },
        include: {
          orderItem: { include: { order: { select: { id: true, code: true } } } },
          inspector: { select: { id: true, name: true } },
        },
      });
      if (!insp) throw Errors.notFound('Inspection');
      return insp;
    },
  );
}
