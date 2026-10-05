import {
  AssignDriverInput,
  BuildRoutesInput,
  CompleteStopInput,
  FailStopInput,
  IdParams,
  LocationAcceptedDto,
  LocationPing,
  RouteDetailDto,
  RouteDto,
  RouteListDto,
  RoutePageDto,
  RouteQuery,
  RoutesBuiltDto,
  StopDto,
} from '@farmgo/contracts';
import {
  arriveAtStop,
  assignDriver,
  buildRoutes,
  completeStop,
  Errors,
  failStop,
  startRoute,
} from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { isAdmin, requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';
import { recordLocation } from './logistics.service.js';
import { assertOwnKeys } from './uploads.routes.js';

const routeInclude = {
  driver: { select: { id: true, name: true, phoneNumber: true } },
  stops: {
    orderBy: { sequence: 'asc' as const },
    include: {
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
  },
};

type RouteWithStops = Prisma.RouteGetPayload<{ include: typeof routeInclude }>;

/** Drivers see the buyer's phone on drop-offs only (not when collecting from the farm). */
function shapeStops(route: RouteWithStops) {
  return {
    ...route,
    stops: route.stops.map((s) => {
      const { buyerOrg, ...order } = s.order;
      return {
        ...s,
        order: {
          ...order,
          buyerOrg: {
            name: buyerOrg.name,
            phone: s.kind === 'DROPOFF' ? (buyerOrg.profile?.phone ?? null) : null,
          },
        },
      };
    }),
  };
}

export default async function logisticsRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/routes',
    {
      schema: {
        tags: ['logistics'],
        summary: 'All routes (admin)',
        querystring: RouteQuery,
        response: ok(RoutePageDto),
      },
    },
    async (req) => {
      requirePermission(req, { route: ['build'] });
      const q = req.query;
      const rows = await app.prisma.route.findMany({
        where: {
          ...(q.date ? { date: new Date(q.date.toISOString().slice(0, 10)) } : {}),
          ...(q.county ? { county: q.county } : {}),
        },
        include: { driver: { select: { id: true, name: true } }, _count: { select: { stops: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.post(
    '/v1/routes/build',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Batch QA-passed orders into delivery routes',
        body: BuildRoutesInput,
        response: created(RoutesBuiltDto),
      },
    },
    async (req, reply) => {
      requirePermission(req, { route: ['build'] });
      const routes = await buildRoutes(app.prisma, req.body.date, req.body.county);
      return reply.status(201).send({ created: routes.length, routes });
    },
  );

  r.post(
    '/v1/routes/:id/assign',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Assign a driver (and vehicle) to a planned route',
        params: IdParams,
        body: AssignDriverInput,
        response: ok(RouteDto),
      },
    },
    async (req) => {
      requirePermission(req, { route: ['assign'] });
      return app.prisma.$transaction((tx) =>
        assignDriver(tx, req.params.id, req.body.driverId, req.body.vehicle),
      );
    },
  );

  r.get(
    '/v1/routes/today',
    {
      schema: {
        tags: ['logistics'],
        summary: 'My routes for today and anything still open (driver)',
        response: ok(RouteListDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      const today = new Date(new Date().toISOString().slice(0, 10));
      const routes = await app.prisma.route.findMany({
        where: {
          driverId: user.id,
          OR: [{ date: today }, { status: 'IN_PROGRESS' }, { status: 'PLANNED', date: { lt: today } }],
        },
        include: routeInclude,
        orderBy: { date: 'asc' },
      });
      return routes.map(shapeStops);
    },
  );

  r.get(
    '/v1/routes/:id',
    {
      schema: {
        tags: ['logistics'],
        summary: 'A route with its stops and the last driver location',
        params: IdParams,
        response: ok(RouteDetailDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['read'] });
      const route = await app.prisma.route.findUnique({
        where: { id: req.params.id },
        include: routeInclude,
      });
      if (!route || (!isAdmin(user) && route.driverId !== user.id)) throw Errors.notFound('Route');
      const lastLocation = await app.prisma.driverLocation.findFirst({
        where: { routeId: route.id },
        orderBy: { recordedAt: 'desc' },
      });
      return { ...shapeStops(route), lastLocation };
    },
  );

  r.post(
    '/v1/routes/:id/start',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Driver starts the route',
        params: IdParams,
        response: ok(RouteDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      return app.prisma.$transaction((tx) => startRoute(tx, req.params.id, user.id, isAdmin(user)));
    },
  );

  r.post(
    '/v1/routes/:id/location',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Share driver location (REST fallback for the WebSocket)',
        params: IdParams,
        body: LocationPing.omit({ routeId: true }),
        response: ok(LocationAcceptedDto),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      return recordLocation(app.prisma, app.redis, user.id, { ...req.body, routeId: req.params.id });
    },
  );

  r.post(
    '/v1/stops/:id/arrive',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Driver has arrived at a stop',
        params: IdParams,
        response: ok(StopDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      return app.prisma.$transaction((tx) => arriveAtStop(tx, req.params.id, user.id, isAdmin(user)));
    },
  );

  r.post(
    '/v1/stops/:id/complete',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Complete a pickup or drop-off (with proof of delivery and crate scans)',
        params: IdParams,
        body: CompleteStopInput,
        response: ok(StopDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      const keys = [req.body.podPhotoKey, req.body.signatureKey].filter((k): k is string => !!k);
      if (keys.length) await assertOwnKeys(req, keys);
      return app.prisma.$transaction(
        (tx) => completeStop(tx, req.params.id, req.body, user.id, isAdmin(user)),
        { timeout: 20_000 },
      );
    },
  );

  r.post(
    '/v1/stops/:id/fail',
    {
      schema: {
        tags: ['logistics'],
        summary: 'Record a failed stop; the order is released for re-planning',
        params: IdParams,
        body: FailStopInput,
        response: ok(StopDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      return app.prisma.$transaction((tx) =>
        failStop(tx, req.params.id, req.body.reason, user.id, isAdmin(user)),
      );
    },
  );
}
