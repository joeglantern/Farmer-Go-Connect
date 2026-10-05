import type {
  CreateListingInput,
  DemandBoardDto,
  FarmDetailDto,
  FarmDto,
  FarmerDashboardDto,
  FarmInput,
  InputOrderCreatedDto,
  InputOrderPageDto,
  InputProductListItemDto,
  InputProductPageDto,
  LatestPriceDto,
  ListingDto,
  ListingPageDto,
  MatchAcceptDto,
  MatchPageDto,
  OwnListingDto,
  PayoutPageDto,
  PriceDto,
  UpdateListingInput,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';

/** Request bodies use ISO date strings where the zod input schema coerces dates. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | undefined ? string | undefined : T[K];
};
export type ListingBody = Wire<CreateListingInput>;
export type ListingPatch = Wire<UpdateListingInput>;
export type FarmBody = Omit<FarmInput, 'isOrganic'> & { isOrganic?: boolean };

// ─── Farms ────────────────────────────────────────────────────

export function useFarms(enabled = true, farmerId?: string) {
  return useQuery({
    queryKey: farmerId ? ['farms', 'of', farmerId] : ['farms'],
    enabled,
    queryFn: () => api.get<FarmDto[]>('/v1/farms', { farmerId }),
  });
}

export function useFarm(id: string | undefined) {
  return useQuery({
    queryKey: ['farm', id],
    enabled: !!id,
    queryFn: () => api.get<FarmDetailDto>(`/v1/farms/${id}`),
  });
}

export function useSaveFarm(id?: string) {
  const qc = useQueryClient();
  const refreshMe = useSession((s) => s.refreshMe);
  return useMutation({
    mutationFn: (
      body: Partial<Omit<FarmBody, 'lat' | 'lng'>> & {
        active?: boolean;
        lat?: number | null;
        lng?: number | null;
      },
    ) => (id ? api.patch<FarmDto>(`/v1/farms/${id}`, body) : api.post<FarmDto>('/v1/farms', body)),
    onSuccess: (farm) => {
      qc.setQueryData<FarmDto[]>(['farms'], (prev) =>
        prev ? [...prev.filter((f) => f.id !== farm.id), farm] : prev,
      );
      void qc.invalidateQueries({ queryKey: ['farms'] });
      void qc.invalidateQueries({ queryKey: ['farm', farm.id] });
      void refreshMe();
    },
  });
}

/** DELETE /v1/farms/:id: deleted, or archived when the farm has history. 409 FARM_IN_USE while busy. */
export function useDeleteFarm(id: string) {
  const qc = useQueryClient();
  const refreshMe = useSession((s) => s.refreshMe);
  return useMutation({
    mutationFn: () => api.delete<{ ok: true; archived: boolean }>(`/v1/farms/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['farms'] });
      void qc.invalidateQueries({ queryKey: ['farm', id] });
      void refreshMe();
    },
  });
}

// ─── Listings ─────────────────────────────────────────────────

export type ListingScope = 'active' | 'upcoming' | 'closed';
const ACTIVE = ['OPEN', 'PARTIALLY_MATCHED', 'DRAFT'];

export function isLiveListing(l: Pick<ListingDto, 'status' | 'availableTo'>) {
  return ACTIVE.includes(l.status) && new Date(l.availableTo).getTime() >= Date.now() - 86_400_000;
}

/** The caller's listings (every status), newest window first after sorting on the client. */
export function useMyListings() {
  return useInfiniteQuery({
    queryKey: ['listings', 'mine'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<ListingPageDto>('/v1/supply', { mine: true, cursor: pageParam, limit: 50 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMyListing(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: !!id,
    queryFn: () => api.get<ListingDto>(`/v1/supply/${id}`),
  });
}

function invalidateListings(qc: ReturnType<typeof useQueryClient>, id?: string) {
  void qc.invalidateQueries({ queryKey: ['listings'] });
  void qc.invalidateQueries({ queryKey: ['supply'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  if (id) void qc.invalidateQueries({ queryKey: ['listing', id] });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingBody) => api.post<OwnListingDto>('/v1/supply', body),
    onSuccess: (l) => invalidateListings(qc, l.id),
  });
}

export function useUpdateListing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingPatch) => api.patch<OwnListingDto>(`/v1/supply/${id}`, body),
    onSuccess: () => invalidateListings(qc, id),
  });
}

/** Mark the harvest in (confirmed orders go to QA), or undo it before any has. */
export function useHarvestReady(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (undo?: boolean) =>
      undo
        ? api.delete<unknown>(`/v1/supply/${id}/harvest-ready`).then(() => ({ ordersReady: 0 }))
        : api.post<{ ordersReady: number }>(`/v1/supply/${id}/harvest-ready`, {}),
    onSuccess: () => {
      invalidateListings(qc, id);
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

// ─── Demand and matches ───────────────────────────────────────

export function useDemandBoard(county: string | null, weeks = 4, mine = false) {
  return useQuery({
    queryKey: ['demand', 'board', county, weeks, mine],
    queryFn: () =>
      api.get<DemandBoardDto>('/v1/demand/board', {
        county: county ?? undefined,
        weeks,
        mine: mine || undefined,
      }),
  });
}

export function useMatches(status?: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED') {
  return useInfiniteQuery({
    queryKey: ['matches', status ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<MatchPageDto>('/v1/matches', { status, cursor: pageParam, limit: 30 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMatchAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.post<MatchAcceptDto | { ok: true }>(`/v1/matches/${id}/${action}`, {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['listings'] });
      void qc.invalidateQueries({ queryKey: ['demand'] });
    },
  });
}

// ─── Money ────────────────────────────────────────────────────

/** Payouts and the money summary. Suppliers pass `as: 'supplier'` for green-input sales. */
export function usePayouts(as: 'farmer' | 'supplier' = 'farmer') {
  return useInfiniteQuery({
    queryKey: ['payouts', as],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<PayoutPageDto>('/v1/payouts', { as, cursor: pageParam, limit: 30 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// ─── Prices ───────────────────────────────────────────────────

export function useLatestPrices(county?: string | null, produceId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['prices', 'latest', county ?? 'all', produceId ?? 'all'],
    enabled,
    queryFn: () =>
      api.get<LatestPriceDto[]>('/v1/prices/latest', {
        county: county ?? undefined,
        produceId: produceId ?? undefined,
      }),
    staleTime: 600_000,
  });
}

export function usePriceHistory(produceId: string | undefined, county?: string | null, weeks = 12) {
  return useQuery({
    queryKey: ['prices', 'history', produceId, county ?? 'all', weeks],
    enabled: !!produceId,
    queryFn: () => api.get<PriceDto[]>('/v1/prices', { produceId, county: county ?? undefined, weeks }),
    staleTime: 600_000,
  });
}

// ─── Dashboard ────────────────────────────────────────────────

export interface FarmerDashboard {
  activeListings: number;
  ordersReceived: number;
  /** Paid out to M-Pesa, all time. */
  totalSales: number;
  /** Paid out this calendar month. */
  monthSales: number;
  /** Delivered or in progress, not yet paid out. */
  pendingPayout: number;
  rating: number | null;
  proposedMatches: number;
}

/** Mockup 9 numbers, from GET /v1/dashboard/farmer in one call. */
export function useFarmerDashboard() {
  const rating = useSession((s) => s.me?.farmerProfile?.ratingAvg ?? null);
  return useQuery({
    queryKey: ['dashboard', 'farmer'],
    queryFn: async ({ signal }): Promise<FarmerDashboard> => {
      const d = await api.get<z.infer<typeof FarmerDashboardDto>>('/v1/dashboard/farmer', undefined, signal);
      return {
        activeListings: d.activeListings,
        ordersReceived: d.ordersReceived.allTime,
        totalSales: d.sales.allTimeCents,
        monthSales: d.sales.thisMonthCents,
        pendingPayout: d.actions.payoutsPendingCents,
        rating: d.rating ?? rating,
        proposedMatches: d.actions.matchesWaiting,
      };
    },
  });
}

// ─── Green inputs ─────────────────────────────────────────────

export function useInputs(filters: { q?: string; category?: string; county?: string }) {
  return useInfiniteQuery({
    queryKey: ['inputs', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<InputProductPageDto>('/v1/inputs', { ...filters, cursor: pageParam, limit: 30 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInput(id: string | undefined) {
  return useQuery({
    queryKey: ['input', id],
    enabled: !!id,
    queryFn: () => api.get<InputProductListItemDto>(`/v1/inputs/${id}`),
  });
}

/** Input orders the caller placed as a buyer. */
export function useMyInputOrders() {
  return useQuery({
    queryKey: ['inputOrders', 'placed'],
    queryFn: async () =>
      (await api.get<InputOrderPageDto>('/v1/input-orders', { as: 'buyer', limit: 100 })).items,
  });
}

export function useOrderInput(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      ...body
    }: {
      quantity: number;
      deliveryNote?: string;
      phoneNumber?: string;
      idempotencyKey: string;
    }) => api.post<InputOrderCreatedDto>(`/v1/inputs/${productId}/order`, body, { idempotencyKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inputOrders'] });
      void qc.invalidateQueries({ queryKey: ['input', productId] });
      void qc.invalidateQueries({ queryKey: ['inputs'] });
    },
  });
}

/** Buyer-side moves on a green-input order: cancel, confirm delivery, pay again, report a problem. */
export function useInputOrderAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: 'transition' | 'pay' | 'dispute'; body: unknown }) =>
      api.post(`/v1/input-orders/${id}/${path}`, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['inputOrders'] }),
  });
}

/** YYYY-MM-DD for a local date. */
export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
