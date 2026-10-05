import type { InspectionHistoryPageDto, QaDashboardDto, QaTaskDto, QaTaskListDto } from '@farmgo/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';
import type { z } from 'zod';
import { api } from '../../lib/api';

/** B23: tasks in one county, or every county with `all` (the QA home uses `all`). */
export function useQaTasks(county: string = 'all') {
  return useQuery({
    queryKey: ['qaTasks', county],
    queryFn: () => api.get<QaTaskListDto>('/v1/qa/tasks', { county }),
    refetchInterval: 60_000,
  });
}

/** B10 QA dashboard: work waiting per county, today's count, pass rate this month. */
export function useQaDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'qa'],
    queryFn: () => api.get<QaDashboardDto>('/v1/dashboard/qa'),
    refetchInterval: 60_000,
  });
}

/** One task, found in the all-counties list (shares the QA home's cache). */
export function useQaTask(orderId: string | undefined) {
  const q = useQaTasks('all');
  return { ...q, data: q.data?.find((o) => o.id === orderId) as QaTaskDto | undefined };
}

/** B19: the officer's own past inspections, passed or failed. */
export function useQaHistory(passed: boolean) {
  return useInfiniteQuery({
    queryKey: ['qaInspections', passed],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<z.infer<typeof InspectionHistoryPageDto>>(
        '/v1/qa/inspections',
        { passed, cursor: pageParam, limit: 30 },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function callPhone(phone: string | null | undefined) {
  if (phone) void Linking.openURL(`tel:${phone}`);
}

/** Open turn-by-turn directions in the phone's maps app (or Google Maps on the web). */
export function openDirections(
  lat: number | null | undefined,
  lng: number | null | undefined,
  label: string,
) {
  if (lat == null || lng == null) {
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`);
    return;
  }
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
      : Platform.OS === 'android'
        ? `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  void Linking.openURL(url);
}
