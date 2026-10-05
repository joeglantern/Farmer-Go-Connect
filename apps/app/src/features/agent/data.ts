import type { AgentDashboardDto, AgentFarmerDetailDto, AgentFarmerDto } from '@farmgo/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Tone } from '../../ui/Controls';

type FarmerPage = { items: AgentFarmerDto[]; nextCursor: string | null };

export function useAgentFarmers() {
  return useInfiniteQuery({
    queryKey: ['agentFarmers'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<FarmerPage>('/v1/agent/farmers', { cursor: pageParam, limit: 100 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** B20: one farmer the agent registered, with farms, their listings and performance. */
export function useAgentFarmer(id: string | undefined) {
  return useQuery({
    queryKey: ['agentFarmers', 'one', id],
    enabled: !!id,
    queryFn: () => api.get<AgentFarmerDetailDto>(`/v1/agent/farmers/${id}`),
  });
}

/** B10 agent dashboard: farmers onboarded, listings created, ID checks pending. */
export function useAgentDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'agent'],
    queryFn: () => api.get<AgentDashboardDto>('/v1/dashboard/agent'),
  });
}

export function kycView(status: AgentFarmerDto['kycStatus']): { labelKey: string; tone: Tone } {
  switch (status) {
    case 'VERIFIED':
      return { labelKey: 'agent.kyc.VERIFIED', tone: 'success' };
    case 'SUBMITTED':
      return { labelKey: 'agent.kyc.SUBMITTED', tone: 'info' };
    case 'REJECTED':
      return { labelKey: 'agent.kyc.REJECTED', tone: 'danger' };
    default:
      return { labelKey: 'agent.kyc.PENDING', tone: 'warning' };
  }
}

/** "0712 345 678" style for display. */
export function prettyPhone(p: string | null | undefined) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^254/, '0');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : p;
}
