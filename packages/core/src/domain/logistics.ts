import type { CompleteStopInput } from '@farmgo/contracts';
import type { DB, PrismaClient, Route } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { nextRouteCode } from './codes.js';
import { scanCrate } from './crates.js';
import { COUNTY_CENTROIDS, haversineKm, type Point, pointOrCentroid } from './geo.js';
import { transitionOrder } from './order-machine.js';

const MAX_ORDERS_PER_ROUTE = 12;

export interface Stop {
  key: string;
  point: Point | null;
}

/** Nearest-neighbour ordering from a start point. Stops without coordinates go last. */
export function nearestNeighbour<T extends Stop>(
  start: Point,
  stops: T[],
): { ordered: T[]; distanceKm: number } {
  const withPoint = stops.filter((s) => s.point) as (T & { point: Point })[];
  const without = stops.filter((s) => !s.point);
  const ordered: T[] = [];
  let current = start;
  let distanceKm = 0;
  const pool = [...withPoint];
  while (pool.length) {
    let bestIdx = 0;
    let bestD = Number.POSITIVE_INFINITY;
    pool.forEach((s, i) => {
      const d = haversineKm(current, s.point);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    });
    const [next] = pool.splice(bestIdx, 1);
    ordered.push(next!);
    distanceKm += bestD;
    current = next!.point;
  }
  return { ordered: [...ordered, ...without], distanceKm: Math.round(distanceKm * 10) / 10 };
}

/**
 * Order drop-offs by delivery window (earliest first; orders without a window last), and by
 * nearest neighbour inside each window, continuing from where the previous window ended.
 */
export function dropoffsByWindow<T extends Stop & { window: string | null }>(
  start: Point,
  stops: T[],
): { ordered: T[]; distanceKm: number } {
  const keys = [...new Set(stops.map((s) => s.window ?? '~'))].sort();
  const ordered: T[] = [];
  let distanceKm = 0;
  let from = start;
  for (const k of keys) {
    const group = nearestNeighbour(
      from,
      stops.filter((s) => (s.window ?? '~') === k),
    );
    ordered.push(...group.ordered);
    distanceKm += group.distanceKm;
    from = [...group.ordered].reverse().find((s) => s.point)?.point ?? from;
  }
  return { ordered, distanceKm: Math.round(distanceKm * 10) / 10 };
}

const dayRange = (date: Date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

/**
 * Batch QA-passed orders due on `date` into routes per county. Each route picks up from
 * farms first (nearest-neighbour from the county depot), then drops off at buyers
 * (nearest-neighbour from the last pickup). Drivers in the county are assigned round-robin.
 */
export async function buildRoutes(prisma: PrismaClient, date: Date, county?: string): Promise<Route[]> {
  const { start, end } = dayRange(date);
  const orders = await prisma.order.findMany({
    where: {
      status: 'QA_PASSED',
      routeId: null,
      deliveryDate: { lt: end },
      ...(county ? { buyerOrg: { profile: { county } } } : {}),
    },
    include: {
      buyerOrg: { include: { profile: true } },
      items: { include: { listing: { include: { farm: true } } } },
    },
    orderBy: { deliveryDate: 'asc' },
  });

  const byCounty = new Map<string, typeof orders>();
  for (const o of orders) {
    const c = o.buyerOrg.profile?.county ?? 'Nairobi';
    if (!byCounty.has(c)) byCounty.set(c, []);
    byCounty.get(c)!.push(o);
  }

  const routes: Route[] = [];
  for (const [routeCounty, countyOrders] of byCounty) {
    const drivers = await prisma.user.findMany({
      where: {
        role: 'driver',
        banned: { not: true },
        county: routeCounty,
        routes: { none: { date: start } },
      },
      select: { id: true },
    });
    const depot = COUNTY_CENTROIDS[routeCounty] ?? COUNTY_CENTROIDS.Nairobi!;

    for (let i = 0; i < countyOrders.length; i += MAX_ORDERS_PER_ROUTE) {
      const batch = countyOrders.slice(i, i + MAX_ORDERS_PER_ROUTE);
      const pickups = nearestNeighbour(
        depot,
        batch.map((o) => {
          const farm = o.items[0]!.listing.farm;
          return {
            key: o.id,
            point: pointOrCentroid(farm, farm.county),
            order: o,
            address: `${farm.name}, ${farm.ward ?? farm.county}`,
          };
        }),
      );
      const lastPickup = [...pickups.ordered].reverse().find((s) => s.point)?.point ?? depot;
      const dropoffs = dropoffsByWindow(
        lastPickup,
        batch.map((o) => ({
          key: o.id,
          point: pointOrCentroid(
            { lat: o.deliveryLat, lng: o.deliveryLng },
            o.buyerOrg.profile?.county ?? routeCounty,
          ),
          order: o,
          address: o.deliveryAddress ?? o.buyerOrg.name,
          window: o.deliveryWindow,
        })),
      );
      const driverId = drivers[routes.length % Math.max(1, drivers.length)]?.id ?? null;

      const route = await prisma.$transaction(async (tx) => {
        const r = await tx.route.create({
          data: {
            code: await nextRouteCode(tx),
            date: start,
            county: routeCounty,
            driverId,
            distanceKm: pickups.distanceKm + dropoffs.distanceKm,
          },
        });
        let seq = 0;
        for (const s of pickups.ordered) {
          await tx.delivery.create({
            data: {
              routeId: r.id,
              orderId: s.key,
              kind: 'PICKUP',
              sequence: ++seq,
              lat: s.point?.lat,
              lng: s.point?.lng,
              address: s.address,
            },
          });
        }
        for (const s of dropoffs.ordered) {
          await tx.delivery.create({
            data: {
              routeId: r.id,
              orderId: s.key,
              kind: 'DROPOFF',
              sequence: ++seq,
              lat: s.point?.lat,
              lng: s.point?.lng,
              address: s.address,
            },
          });
        }
        await tx.order.updateMany({ where: { id: { in: batch.map((o) => o.id) } }, data: { routeId: r.id } });
        if (driverId)
          await emit(
            tx,
            'route.assigned',
            { routeId: r.id, driverId, date: start.toISOString().slice(0, 10) },
            r.id,
          );
        return r;
      });
      routes.push(route);
    }
  }
  return routes;
}

export async function assignDriver(
  tx: DB,
  routeId: string,
  driverId: string,
  vehicle?: string,
): Promise<Route> {
  const driver = await tx.user.findUnique({ where: { id: driverId } });
  if (driver?.role !== 'driver') throw Errors.badRequest('NOT_A_DRIVER', 'That user is not a driver');
  const route = await tx.route.findUnique({ where: { id: routeId } });
  if (!route) throw Errors.notFound('Route');
  if (route.status !== 'PLANNED')
    throw Errors.conflict('ROUTE_STARTED', 'Only planned routes can be reassigned');
  const updated = await tx.route.update({ where: { id: routeId }, data: { driverId, vehicle } });
  await emit(
    tx,
    'route.assigned',
    { routeId, driverId, date: route.date.toISOString().slice(0, 10) },
    routeId,
  );
  return updated;
}

async function loadStopForDriver(tx: DB, stopId: string, driverId: string, isAdmin: boolean) {
  const stop = await tx.delivery.findUnique({ where: { id: stopId }, include: { route: true, order: true } });
  if (!stop) throw Errors.notFound('Stop');
  if (!isAdmin && stop.route.driverId !== driverId) throw Errors.forbidden('This stop is not on your route');
  if (stop.route.status === 'COMPLETED' || stop.route.status === 'CANCELLED') {
    throw Errors.conflict('ROUTE_CLOSED', 'This route is closed');
  }
  return stop;
}

export async function startRoute(tx: DB, routeId: string, driverId: string, isAdmin = false): Promise<Route> {
  const route = await tx.route.findUnique({ where: { id: routeId } });
  if (!route) throw Errors.notFound('Route');
  if (!isAdmin && route.driverId !== driverId) throw Errors.forbidden('This is not your route');
  if (route.status !== 'PLANNED')
    throw Errors.conflict('ROUTE_NOT_PLANNED', `Route is ${route.status.toLowerCase()}`);
  const r = await tx.route.update({
    where: { id: routeId },
    data: { status: 'IN_PROGRESS', startedAt: new Date() },
  });
  await emit(tx, 'route.updated', { routeId, driverId: r.driverId }, routeId);
  return r;
}

export async function arriveAtStop(tx: DB, stopId: string, driverId: string, isAdmin = false) {
  const stop = await loadStopForDriver(tx, stopId, driverId, isAdmin);
  const s = await tx.delivery.update({
    where: { id: stop.id },
    data: { status: 'ARRIVED', arrivedAt: new Date() },
  });
  await emit(tx, 'delivery.stop_updated', {
    routeId: stop.routeId,
    stopId: s.id,
    orderId: s.orderId,
    status: s.status,
    kind: s.kind,
  });
  return s;
}

/**
 * Complete a stop. A pickup moves the order to IN_TRANSIT and loads crates; a drop-off
 * records proof of delivery, hands crates to the buyer, and moves the order to DELIVERED.
 */
export async function completeStop(
  tx: DB,
  stopId: string,
  input: CompleteStopInput,
  driverId: string,
  isAdmin = false,
) {
  const stop = await loadStopForDriver(tx, stopId, driverId, isAdmin);
  if (stop.status === 'COMPLETED') return stop;
  const actor = isAdmin ? 'admin' : 'driver';

  if (stop.kind === 'PICKUP') {
    if (stop.order.status === 'QA_PASSED') {
      await transitionOrder(tx, {
        orderId: stop.orderId,
        to: 'IN_TRANSIT',
        actor,
        actorId: driverId,
        note: 'Collected from farm',
      });
    }
    for (const qr of input.crateQrCodes) {
      await scanCrate(
        tx,
        { qrCode: qr, action: 'LOAD', orderId: stop.orderId, deliveryId: stop.id },
        driverId,
      );
    }
  } else {
    const pickup = await tx.delivery.findUnique({
      where: { orderId_kind: { orderId: stop.orderId, kind: 'PICKUP' } },
    });
    if (pickup && pickup.status !== 'COMPLETED' && pickup.status !== 'SKIPPED') {
      throw new AppError('PICKUP_NOT_DONE', 'Collect this order from the farm before delivering it', 409);
    }
    if (!input.podPhotoKey && !input.signatureKey) {
      throw Errors.badRequest('POD_REQUIRED', 'Add a delivery photo or the recipient signature');
    }
    for (const qr of input.crateQrCodes) {
      await scanCrate(
        tx,
        {
          qrCode: qr,
          action: 'DELIVER_TO_BUYER',
          orderId: stop.orderId,
          deliveryId: stop.id,
          toOrgId: stop.order.buyerOrgId,
        },
        driverId,
      );
    }
    for (const qr of input.cratesCollectedQrCodes) {
      await scanCrate(
        tx,
        { qrCode: qr, action: 'RETURN', orderId: stop.orderId, deliveryId: stop.id },
        driverId,
      );
    }
    if (stop.order.status === 'IN_TRANSIT') {
      await transitionOrder(tx, {
        orderId: stop.orderId,
        to: 'DELIVERED',
        actor,
        actorId: driverId,
        note: 'Delivered to buyer',
      });
    }
  }

  const s = await tx.delivery.update({
    where: { id: stop.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      arrivedAt: stop.arrivedAt ?? new Date(),
      podPhotoKey: input.podPhotoKey,
      signatureKey: input.signatureKey,
      recipientName: input.recipientName,
      cratesDropped: stop.kind === 'DROPOFF' ? input.crateQrCodes.length : 0,
      cratesCollected:
        input.cratesCollectedQrCodes.length + (stop.kind === 'PICKUP' ? input.crateQrCodes.length : 0),
    },
  });
  await emit(tx, 'delivery.stop_updated', {
    routeId: stop.routeId,
    stopId: s.id,
    orderId: s.orderId,
    status: s.status,
    kind: s.kind,
  });
  await closeRouteIfDone(tx, stop.routeId);
  return s;
}

export async function failStop(tx: DB, stopId: string, reason: string, driverId: string, isAdmin = false) {
  const stop = await loadStopForDriver(tx, stopId, driverId, isAdmin);
  const s = await tx.delivery.update({
    where: { id: stop.id },
    data: { status: 'FAILED', failureReason: reason, completedAt: new Date() },
  });
  // The order leaves the route so it can be re-planned.
  await tx.order.update({ where: { id: stop.orderId }, data: { routeId: null } });
  await emit(tx, 'delivery.stop_updated', {
    routeId: stop.routeId,
    stopId: s.id,
    orderId: s.orderId,
    status: s.status,
    kind: s.kind,
  });
  await closeRouteIfDone(tx, stop.routeId);
  return s;
}

async function closeRouteIfDone(tx: DB, routeId: string) {
  const open = await tx.delivery.count({ where: { routeId, status: { in: ['PENDING', 'ARRIVED'] } } });
  if (open === 0) {
    const r = await tx.route.update({
      where: { id: routeId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await emit(tx, 'route.updated', { routeId, driverId: r.driverId }, routeId);
  }
}
