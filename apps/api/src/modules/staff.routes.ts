import {
  AgentFarmerDetailDto,
  DriverRoutePageDto,
  DriverRouteQuery,
  IdParams,
  InspectionHistoryPageDto,
  InspectionHistoryQuery,
  StopDetailDto,
} from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { isAdmin, requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { ok, typed } from '../lib/route.js';

const DONE = ['COMPLETED', 'FAILED', 'SKIPPED'];

/** Staff history and single-record reads (B19, B20). */
export default async function staffRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/qa/inspections',
    {
      schema: {
        tags: ['qa'],
        summary: "My past inspections, newest first (admins see everyone's)",
        querystring: InspectionHistoryQuery,
        response: ok(InspectionHistoryPageDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { qa: ['read'] });
      const q = req.query;
      const rows = await app.prisma.qualityInspection.findMany({
        where: {
          ...(isAdmin(user) ? {} : { inspectorId: user.id }),
          ...(q.passed !== undefined ? { passed: q.passed } : {}),
        },
        include: {
          orderItem: {
            select: {
              id: true,
              quantity: true,
              order: { select: { id: true, code: true, status: true, buyerOrg: { select: { name: true } } } },
              listing: {
                select: {
                  produce: { select: { name: true, nameSw: true, unit: true } },
                  farm: { select: { name: true, county: true } },
                },
              },
            },
          },
        },
        orderBy: [{ inspectedAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.get(
    '/v1/driver/routes',
    {
      schema: {
        tags: ['logistics'],
        summary: 'My routes, newest first, with stop progress (driver)',
        querystring: DriverRouteQuery,
        response: ok(DriverRoutePageDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      const q = req.query;
      const rows = await app.prisma.route.findMany({
        where: { driverId: user.id, ...(q.status ? { status: q.status } : {}) },
        include: { stops: { select: { status: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      const page = paginate(rows, q.limit);
      return {
        ...page,
        items: page.items.map(({ stops, ...route }) => ({
          ...route,
          stopsTotal: stops.length,
          stopsDone: stops.filter((s) => DONE.includes(s.status)).length,
        })),
      };
    },
  );

  r.get(
    '/v1/stops/:id',
    {
      schema: {
        tags: ['logistics'],
        summary: 'One stop with its route and order (driver on that route, admin)',
        params: IdParams,
        response: ok(StopDetailDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['read'] });
      const stop = await app.prisma.delivery.findUnique({
        where: { id: req.params.id },
        include: {
          route: { select: { id: true, code: true, status: true, date: true, driverId: true } },
          order: {
            select: {
              id: true,
              code: true,
              status: true,
              deliveryWindow: true,
              buyerOrg: { select: { name: true, profile: { select: { phone: true } } } },
              items: {
                select: {
                  quantity: true,
                  listing: { select: { produce: { select: { name: true, nameSw: true, unit: true } } } },
                },
              },
            },
          },
        },
      });
      if (!stop || (!isAdmin(user) && stop.route.driverId !== user.id)) throw Errors.notFound('Stop');
      const { driverId: _d, ...route } = stop.route;
      const { buyerOrg, ...order } = stop.order;
      return {
        ...stop,
        route: { ...route, date: route.date.toISOString().slice(0, 10) },
        order: {
          ...order,
          // The buyer's contact is only for delivering, not for collecting from the farm.
          buyerOrg: {
            name: buyerOrg.name,
            phone: stop.kind === 'DROPOFF' ? (buyerOrg.profile?.phone ?? null) : null,
          },
        },
      };
    },
  );

  r.get(
    '/v1/agent/farmers/:id',
    {
      schema: {
        tags: ['me'],
        summary: 'One farmer I onboarded: profile, KYC, farms with listings, performance',
        params: IdParams,
        response: ok(AgentFarmerDetailDto),
      },
    },
    async (req) => {
      const agent = requirePermission(req, { farmer: ['onboard'] });
      const f = await app.prisma.farmerProfile.findUnique({
        where: { id: req.params.id },
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true, county: true, phoneNumberVerified: true },
          },
          farms: {
            orderBy: { createdAt: 'asc' },
            include: { listings: { include: { produce: true }, orderBy: { createdAt: 'desc' }, take: 20 } },
          },
        },
      });
      if (!f || (!isAdmin(agent) && f.onboardedById !== agent.id)) throw Errors.notFound('Farmer');
      const [ordersTotal, activeListings, paid] = await Promise.all([
        app.prisma.order.count({ where: { farmerId: f.userId } }),
        app.prisma.supplyListing.count({
          where: {
            farm: { farmerId: f.id },
            status: { in: ['OPEN', 'PARTIALLY_MATCHED'] },
            availableTo: { gte: new Date() },
          },
        }),
        app.prisma.payout.aggregate({
          where: { farmerId: f.userId, status: 'SUCCESS' },
          _sum: { amount: true },
        }),
      ]);
      return {
        ...f,
        performance: {
          ordersTotal,
          ordersCompleted: f.ordersCompleted,
          activeListings,
          qaPassRate: f.qaPassRate,
          onTimeRate: f.onTimeRate,
          rating: f.ratingAvg,
          paidOutCents: paid._sum.amount ?? 0,
        },
      };
    },
  );
}
