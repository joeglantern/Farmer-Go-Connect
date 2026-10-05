import type { ConversationDto } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/** One order thread in the Messages inbox (GET /v1/conversations). */
export type Conversation = ConversationDto;

/**
 * The Messages inbox. The server scopes threads to the caller and names the other side, so
 * the perspective only keeps buyer and farmer caches apart when an admin views as either.
 */
export function useConversations(perspective: 'buyer' | 'farmer' | 'staff') {
  return useQuery({
    queryKey: ['conversations', perspective],
    queryFn: ({ signal }) => api.get<ConversationDto[]>('/v1/conversations', undefined, signal),
  });
}

/**
 * Mark a thread read. Runs in the background when a thread opens; a failure only means the
 * unread badge stays until the next open, so it is not surfaced to the user.
 */
export function useMarkRead(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/v1/orders/${orderId}/messages/read`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });
}
