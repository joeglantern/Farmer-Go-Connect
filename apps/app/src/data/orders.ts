import type {
  MessageDto,
  MessageListDto,
  OrderDetailDto,
  OrderPageDto,
  OrderStatus,
  TrackingDto,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Tone } from '../ui/Controls';
import type { IconName } from '../ui/Icon';

/** Active and Past tabs; the API splits them (`scope`, see ACTIVE_ORDER_STATUSES in contracts). */
export function useOrders(scope: 'active' | 'past', status?: OrderStatus) {
  return useInfiniteQuery({
    queryKey: ['orders', { scope, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<OrderPageDto>('/v1/orders', { cursor: pageParam, limit: 30, scope, status }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    enabled: !!id,
    queryFn: () => api.get<OrderDetailDto>(`/v1/orders/${id}`),
  });
}

export function useTracking(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['order', id, 'tracking'],
    enabled: !!id && enabled,
    queryFn: () => api.get<TrackingDto>(`/v1/orders/${id}/tracking`),
    refetchInterval: 30_000,
  });
}

/** Run an order action and refresh everything that shows the order. */
export function useOrderAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post<unknown>(`/v1/orders/${id}/${path}`, body ?? {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Order chat thread, oldest first. Realtime `order.message` invalidates it. */
export function useMessages(orderId: string | undefined) {
  return useQuery({
    queryKey: ['messages', orderId],
    enabled: !!orderId,
    queryFn: () => api.get<MessageListDto>(`/v1/orders/${orderId}/messages`),
  });
}

export function useSendMessage(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; photos: string[] }) =>
      api.post<MessageDto>(`/v1/orders/${orderId}/messages`, body),
    onSuccess: (msg) => {
      qc.setQueryData<MessageListDto>(['messages', orderId], (prev) =>
        prev?.some((m) => m.id === msg.id) ? prev : [...(prev ?? []), msg],
      );
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export type Viewer = OrderDetailDto['viewer'];

/** Plain-language status, worded for who is looking. */
export function statusView(
  status: OrderStatus,
  viewer: Viewer | 'list' = 'buyer',
): { labelKey: string; tone: Tone; icon: IconName } {
  const farmer = viewer === 'farmer' || viewer === 'agent';
  switch (status) {
    case 'PENDING':
      return {
        labelKey: farmer ? 'orderStatus.pendingFarmer' : 'orderStatus.pending',
        tone: 'warning',
        icon: 'clock',
      };
    case 'CONFIRMED':
      return {
        labelKey: farmer ? 'orderStatus.confirmedFarmer' : 'orderStatus.confirmed',
        tone: 'brand',
        icon: 'check',
      };
    case 'READY_FOR_QA':
      return { labelKey: 'orderStatus.readyForQa', tone: 'info', icon: 'shield' };
    case 'QA_PASSED':
      return { labelKey: 'orderStatus.qaPassed', tone: 'brand', icon: 'shield' };
    case 'QA_REJECTED':
      return { labelKey: 'orderStatus.qaRejected', tone: 'danger', icon: 'error' };
    case 'IN_TRANSIT':
      return { labelKey: 'orderStatus.inTransit', tone: 'info', icon: 'truck' };
    case 'DELIVERED':
      return { labelKey: 'orderStatus.delivered', tone: 'success', icon: 'checkCircle' };
    case 'DISPUTED':
      return { labelKey: 'orderStatus.disputed', tone: 'warning', icon: 'flag' };
    case 'PAID':
      return {
        labelKey: farmer ? 'orderStatus.paidFarmer' : 'orderStatus.paid',
        tone: 'success',
        icon: 'checkCircle',
      };
    case 'REFUNDED':
      return { labelKey: 'orderStatus.refunded', tone: 'neutral', icon: 'money' };
    case 'CANCELLED':
      return { labelKey: 'orderStatus.cancelled', tone: 'neutral', icon: 'close' };
    default:
      return { labelKey: 'orderStatus.pending', tone: 'neutral', icon: 'clock' };
  }
}

/** Mockup "Track Order" steps: Order Placed, Processing (at farm), Out for Delivery, Delivered. */
export function trackingStep(status: OrderStatus): number {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'CONFIRMED':
    case 'READY_FOR_QA':
    case 'QA_PASSED':
      return 1;
    case 'IN_TRANSIT':
      return 2;
    case 'DELIVERED':
    case 'PAID':
    case 'DISPUTED':
      return 3;
    default:
      return 0;
  }
}
