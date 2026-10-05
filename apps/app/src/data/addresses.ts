import type { AddressDto, AddressInput } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '../lib/api';
import { useSession } from './session';

/** Saved delivery addresses (B08). A buyer's list is shared by their organization. */
export type Address = z.infer<typeof AddressDto>;
export type AddressBody = z.infer<typeof AddressInput>;

const key = ['addresses'] as const;

export function useAddresses() {
  const signedIn = useSession((s) => s.status === 'signedIn' && !!s.me);
  return useQuery({
    queryKey: key,
    enabled: signedIn,
    queryFn: ({ signal }) => api.get<Address[]>('/v1/addresses', undefined, signal),
    staleTime: 60_000,
  });
}

/** One line for lists and pickers: "line1, landmark, town". */
export function addressLine(a: Pick<Address, 'line1' | 'landmark' | 'town' | 'county'>) {
  return [a.line1, a.landmark, a.town ?? a.county].filter(Boolean).join(', ');
}

export function useAddressMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  return {
    create: useMutation({
      mutationFn: (body: AddressBody) => api.post<Address>('/v1/addresses', body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<AddressBody> }) =>
        api.patch<Address>(`/v1/addresses/${id}`, body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/addresses/${id}`),
      onSuccess: refresh,
    }),
  };
}
