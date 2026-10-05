import type {
  BuyerDashboardDto,
  DemandDetailDto,
  DemandPageDto,
  DemandWithProduceDto,
  FeaturedFarmerDto,
  InvoiceDetailDto,
  InvoicePageDto,
  PaymentStartedDto,
  PublicFarmerDto,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type FeaturedFarmer = FeaturedFarmerDto;
export type PublicFarmer = PublicFarmerDto;
export type Requirement = DemandPageDto['items'][number];
export type RequirementDetail = DemandDetailDto;
export type InvoiceRow = InvoicePageDto['items'][number];
export type InvoiceDetail = InvoiceDetailDto;
export type BuyerDashboard = BuyerDashboardDto;

// ─── Farmers (B06) ────────────────────────────────────────────

export function useFarmerDirectory(county?: string) {
  return useQuery({
    queryKey: ['farmers', 'directory', county ?? 'all'],
    queryFn: ({ signal }) => api.get<FeaturedFarmer[]>('/v1/farmers/featured', { limit: 30, county }, signal),
    staleTime: 300_000,
  });
}

export function usePublicFarmer(id: string | undefined) {
  return useQuery({
    queryKey: ['farmer', id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<PublicFarmer>(`/v1/farmers/${id}`, undefined, signal),
    staleTime: 120_000,
  });
}

// ─── Buyer dashboard (B10) ────────────────────────────────────

export function useBuyerDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'buyer', 'full'],
    queryFn: ({ signal }) => api.get<BuyerDashboard>('/v1/dashboard/buyer', undefined, signal),
    staleTime: 60_000,
  });
}

// ─── Requirements (demand) ────────────────────────────────────

export type RequirementFilter = 'open' | 'paused' | 'recurring' | 'closed';

const OPEN = ['OPEN', 'PARTIALLY_FILLED'];

export function useRequirements(filter: RequirementFilter) {
  return useInfiniteQuery({
    queryKey: ['demand', 'mine', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await api.get<DemandPageDto>(
        '/v1/demand',
        {
          cursor: pageParam,
          limit: 30,
          recurringOnly: filter === 'recurring' || undefined,
          status: filter === 'paused' ? 'PAUSED' : undefined,
        },
        signal,
      );
      // The API filters by one status at a time; open and closed each span several.
      const items = page.items.filter((d) =>
        filter === 'open'
          ? OPEN.includes(d.status)
          : filter === 'closed'
            ? !OPEN.includes(d.status) && d.status !== 'PAUSED'
            : true,
      );
      return { ...page, items };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useRequirement(id: string | undefined) {
  return useQuery({
    queryKey: ['demand', 'one', id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<RequirementDetail>(`/v1/demand/${id}`, undefined, signal),
  });
}

export type RequirementBody = {
  produceId: string;
  quantity: number;
  minGrade?: string;
  maxPricePerUnit?: number;
  neededBy: string;
  recurrence?: string;
  recurrenceUntil?: string;
  county?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  notes?: string;
};

export function useRequirementMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['demand'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    create: useMutation({
      mutationFn: (body: RequirementBody) => api.post<DemandWithProduceDto>('/v1/demand', body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<Omit<RequirementBody, 'produceId'>> }) =>
        api.patch<DemandWithProduceDto>(`/v1/demand/${id}`, body),
      onSuccess: refresh,
    }),
    /** Pause (out of matching, no new dates) or resume a requirement (B29). */
    setPaused: useMutation({
      mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
        api.patch<DemandWithProduceDto>(`/v1/demand/${id}`, { status: paused ? 'PAUSED' : 'OPEN' }),
      onSettled: refresh,
    }),
    /** Close a requirement (and, for a recurring one, its future open instances). */
    close: useMutation({
      mutationFn: (id: string) =>
        api.patch<DemandWithProduceDto>(`/v1/demand/${id}`, { status: 'CANCELLED' }),
      onSuccess: refresh,
    }),
  };
}

// ─── Invoices ─────────────────────────────────────────────────

export function useInvoices() {
  return useInfiniteQuery({
    queryKey: ['invoices', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<InvoicePageDto>('/v1/invoices', { cursor: pageParam, limit: 30 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoices', 'one', id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<InvoiceDetail>(`/v1/invoices/${id}`, undefined, signal),
  });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, phoneNumber }: { id: string; phoneNumber?: string }) =>
      api.post<PaymentStartedDto>(`/v1/invoices/${id}/pay`, { phoneNumber }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
