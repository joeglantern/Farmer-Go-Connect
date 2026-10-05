import {
  IdParams,
  InspectionDetailDto,
  InspectionInput,
  InspectionResultDto,
  QaTaskListDto,
  QaTaskQuery,
} from '@farmgo/contracts';
import { Errors, recordInspection } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { isAdmin, requirePermission } from '../lib/guards.js';
import { created, ok, typed } from '../lib/route.js';
import { assertOwnKeys } from './uploads.routes.js';

export default async function qaRoutes(app: FastifyInstance) {
  const r = typed(app);

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
      // `all` covers every county; omitted means the officer's own county (admins: all).
      const county =
        req.query.county === 'all'
          ? undefined
          : (req.query.county ??
            (isAdmin(user) ? undefined : ((user as { county?: string | null }).county ?? undefined)));
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
                  farm: {
                    select: {
                      id: true,
                      name: true,
                      county: true,
                      ward: true,
                      lat: true,
                      lng: true,
                      farmer: { select: { user: { select: { name: true, phoneNumber: true } } } },
                    },
                  },
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
