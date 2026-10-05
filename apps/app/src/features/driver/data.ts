import type {
  CompleteStopInput,
  DriverDashboardDto,
  DriverRoutePageDto,
  RouteDetailDto,
  RouteDto,
  RouteStopDto,
  StopDetailDto,
  StopDto,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '../../lib/api';
import { produceName } from '../../lib/format';
import type { Tone } from '../../ui/Controls';
import type { IconName } from '../../ui/Icon';

export type DashboardRoute = DriverDashboardDto['routes'][number];

/** B10 driver dashboard: today's routes (and anything still open) with progress and next stop. */
export function useDriverDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'driver'],
    queryFn: () => api.get<DriverDashboardDto>('/v1/dashboard/driver'),
    refetchInterval: 60_000,
  });
}

export function useRouteDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['route', id],
    enabled: !!id,
    queryFn: () => api.get<RouteDetailDto>(`/v1/routes/${id}`),
  });
}

/** B20: one stop with its route and order (buyer phone on drop-offs). */
export function useStop(id: string | undefined) {
  return useQuery({
    queryKey: ['stop', id],
    enabled: !!id,
    queryFn: () => api.get<StopDetailDto>(`/v1/stops/${id}`),
  });
}

/** Stops in driving order. */
export function orderedStops(route: { stops: RouteStopDto[] }) {
  return [...route.stops].sort((a, b) => a.sequence - b.sequence);
}

export function isOpenStop(s: { status: StopDto['status'] }) {
  return s.status === 'PENDING' || s.status === 'ARRIVED';
}

/** The next stop to drive to: the first one not yet finished. */
export function nextStop(route: { stops: RouteStopDto[] }) {
  return orderedStops(route).find(isOpenStop) ?? null;
}

/** Start the route and every stop action; refreshes the route and today's list. */
export function useDriverAction(routeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      a:
        | { kind: 'start' }
        | { kind: 'arrive'; stopId: string }
        | { kind: 'complete'; stopId: string; body: Partial<CompleteStopInput> }
        | { kind: 'fail'; stopId: string; reason: string },
    ) => {
      switch (a.kind) {
        case 'start':
          return api.post<RouteDto | StopDto>(`/v1/routes/${routeId}/start`);
        case 'arrive':
          return api.post<RouteDto | StopDto>(`/v1/stops/${a.stopId}/arrive`);
        case 'complete':
          return api.post<RouteDto | StopDto>(`/v1/stops/${a.stopId}/complete`, a.body);
        case 'fail':
          return api.post<RouteDto | StopDto>(`/v1/stops/${a.stopId}/fail`, { reason: a.reason });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['route', routeId] });
      void qc.invalidateQueries({ queryKey: ['stop'] });
      void qc.invalidateQueries({ queryKey: ['routes'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** B19: the driver's routes, newest first, with progress. */
export function useDriverRoutes(status?: RouteDto['status']) {
  return useInfiniteQuery({
    queryKey: ['routes', 'mine', status ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<z.infer<typeof DriverRoutePageDto>>(
        '/v1/driver/routes',
        { status, cursor: pageParam, limit: 30 },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function stopStatusView(status: StopDto['status']): { labelKey: string; tone: Tone; icon: IconName } {
  switch (status) {
    case 'ARRIVED':
      return { labelKey: 'driver.stopStatus.ARRIVED', tone: 'info', icon: 'location' };
    case 'COMPLETED':
      return { labelKey: 'driver.stopStatus.COMPLETED', tone: 'success', icon: 'checkCircle' };
    case 'FAILED':
      return { labelKey: 'driver.stopStatus.FAILED', tone: 'danger', icon: 'error' };
    case 'SKIPPED':
      return { labelKey: 'driver.stopStatus.SKIPPED', tone: 'neutral', icon: 'forward' };
    default:
      return { labelKey: 'driver.stopStatus.PENDING', tone: 'neutral', icon: 'clock' };
  }
}

export function routeStatusView(status: RouteDto['status']): { labelKey: string; tone: Tone } {
  switch (status) {
    case 'IN_PROGRESS':
      return { labelKey: 'driver.routeStatus.IN_PROGRESS', tone: 'brand' };
    case 'COMPLETED':
      return { labelKey: 'driver.routeStatus.COMPLETED', tone: 'success' };
    case 'CANCELLED':
      return { labelKey: 'driver.routeStatus.CANCELLED', tone: 'danger' };
    default:
      return { labelKey: 'driver.routeStatus.PLANNED', tone: 'warning' };
  }
}

type Load = {
  order: {
    items: { quantity: number; listing: { produce: { name: string; nameSw: string; unit: string } } }[];
  };
};

/** One line of what is in the order, e.g. "Tomatoes 40 kg, Kale 20 bunches", in the app language. */
export function loadSummary(stop: Load, unit: (u: string, n: number) => string, fmt: (n: number) => string) {
  return stop.order.items
    .map(
      (i) =>
        `${produceName(i.listing.produce)} ${fmt(i.quantity)} ${unit(i.listing.produce.unit, i.quantity)}`,
    )
    .join(', ');
}

/** "06:00-09:00" -> { from: '06:00', to: '09:00' }, or null when the order has no window. */
export function deliveryWindow(w: string | null | undefined) {
  const m = w?.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return m ? { from: m[1]!, to: m[2]! } : null;
}
