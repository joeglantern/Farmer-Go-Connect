import type {
  InputOrderListItemDto,
  InputOrderPageDto,
  InputProductListItemDto,
  InputProductPageDto,
  SupplierDashboardDto,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';
import type { Tone } from '../../ui/Controls';
import type { IconName } from '../../ui/Icon';

export type InputOrderStatus = InputOrderListItemDto['status'];
export type InputCategory = InputProductListItemDto['category'];

export const CATEGORIES: InputCategory[] = [
  'COMPOST',
  'ORGANIC_FERTILIZER',
  'SEEDLINGS',
  'BIOPESTICIDE',
  'PACKAGING',
  'OTHER',
];
export const CATEGORY_ICON: Record<InputCategory, IconName> = {
  COMPOST: 'leaf',
  ORGANIC_FERTILIZER: 'drop',
  SEEDLINGS: 'seedling',
  BIOPESTICIDE: 'shield',
  PACKAGING: 'crate',
  OTHER: 'basket',
};
/** B10 supplier dashboard: products, orders to handle, sales and payouts (cents). */
export function useSupplierDashboard() {
  const org = useSupplierOrg();
  return useQuery({
    queryKey: ['dashboard', 'supplier', org?.id],
    enabled: !!org,
    queryFn: () => api.get<SupplierDashboardDto>('/v1/dashboard/supplier'),
    refetchInterval: 60_000,
  });
}

/** The signed-in person's input-supplier organization (youth enterprise). */
export function useSupplierOrg() {
  return useSession((s) => s.me?.organizations.find((o) => o.profile?.type === 'INPUT_SUPPLIER') ?? null);
}

/** B21: my products, including hidden ones (GET /v1/inputs?mine=true). */
export function useMyProducts() {
  const org = useSupplierOrg();
  return useInfiniteQuery({
    queryKey: ['inputs', 'mine', org?.id],
    enabled: !!org,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<InputProductPageDto>('/v1/inputs', { mine: true, cursor: pageParam, limit: 100 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  });
}

/**
 * Which products are low on stock. The threshold is an admin setting the app cannot read, but
 * the dashboard counts the active products at or under it (N), and those are exactly the N
 * active products with the least stock. So rank by stock and take N.
 */
export function useLowStockIds(products: InputProductListItemDto[] | undefined) {
  const dash = useSupplierDashboard();
  const n = dash.data?.lowStockProducts ?? 0;
  return useMemo(() => {
    const ranked = (products ?? []).filter((p) => p.active).sort((a, b) => a.stock - b.stock);
    return new Set(ranked.slice(0, n).map((p) => p.id));
  }, [products, n]);
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['inputs', 'one', id],
    enabled: !!id && id !== 'new',
    queryFn: () => api.get<InputProductListItemDto>(`/v1/inputs/${id}`),
  });
}

/** B21: orders for my products (GET /v1/input-orders?as=seller). */
export function useSupplierOrders() {
  const org = useSupplierOrg();
  return useInfiniteQuery({
    queryKey: ['inputOrders', 'seller', org?.id],
    enabled: !!org,
    refetchInterval: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<InputOrderPageDto>('/v1/input-orders', { as: 'seller', cursor: pageParam, limit: 100 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  });
}

export function useTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: InputOrderStatus }) =>
      api.post(`/v1/input-orders/${id}/transition`, { to }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['inputOrders'] });
      void qc.invalidateQueries({ queryKey: ['inputs'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** The supplier's next moves for an order, primary first. */
export function nextMoves(status: InputOrderStatus): InputOrderStatus[] {
  switch (status) {
    case 'PENDING':
      return ['ACCEPTED', 'REJECTED'];
    case 'ACCEPTED':
      return ['DISPATCHED', 'CANCELLED'];
    case 'DISPATCHED':
      return ['DELIVERED'];
    default:
      return [];
  }
}

export function orderStatusView(status: InputOrderStatus): { tone: Tone; icon: IconName } {
  switch (status) {
    case 'PENDING':
      return { tone: 'warning', icon: 'clock' };
    case 'ACCEPTED':
      return { tone: 'info', icon: 'check' };
    case 'DISPATCHED':
      return { tone: 'brand', icon: 'truck' };
    case 'DELIVERED':
      return { tone: 'success', icon: 'checkCircle' };
    default:
      return { tone: 'danger', icon: 'close' };
  }
}
