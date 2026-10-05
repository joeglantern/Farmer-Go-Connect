import type { LocationPing } from '@farmgo/contracts';
import { channels } from '@farmgo/contracts';
import { AppError, Errors, publishRealtime } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';

const MIN_PING_INTERVAL_MS = 5_000;

/**
 * Driver GPS ping (WebSocket or REST). Stored for history and pushed straight to the route and
 * order channels. Not routed through the outbox: pings are frequent and losing one is harmless.
 */
export async function recordLocation(
  prisma: PrismaClient,
  redis: Redis,
  driverId: string,
  ping: LocationPing,
) {
  const route = await prisma.route.findUnique({
    where: { id: ping.routeId },
    select: { id: true, driverId: true, status: true },
  });
  if (!route) throw Errors.notFound('Route');
  if (route.driverId !== driverId) throw Errors.forbidden('This is not your route');
  if (route.status !== 'IN_PROGRESS')
    throw new AppError('ROUTE_NOT_ACTIVE', 'Start the route before sharing location', 409);

  // Throttle per driver so a chatty client cannot flood the database.
  const throttled = !(await redis.set(`loc:throttle:${driverId}`, '1', 'PX', MIN_PING_INTERVAL_MS, 'NX'));
  if (throttled) return { accepted: false };

  const loc = await prisma.driverLocation.create({
    data: {
      routeId: route.id,
      driverId,
      lat: ping.lat,
      lng: ping.lng,
      heading: ping.heading,
      speedKph: ping.speedKph,
    },
  });
  const orders = await prisma.order.findMany({
    where: { routeId: route.id, status: { in: ['QA_PASSED', 'IN_TRANSIT'] } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await publishRealtime(
    redis,
    [channels.route(route.id), ...orderIds.map(channels.order)],
    'delivery.location',
    {
      routeId: route.id,
      orderIds,
      lat: loc.lat,
      lng: loc.lng,
      heading: loc.heading,
      at: loc.recordedAt.toISOString(),
    },
  );
  return { accepted: true };
}
