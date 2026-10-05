import type { BadgesDto } from '@farmgo/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from './session';

export const qk = {
  me: ['me'] as const,
  notifications: (unreadOnly?: boolean) => ['notifications', { unreadOnly: !!unreadOnly }] as const,
  unread: ['notifications', 'unread'] as const,
  badges: ['badges'] as const,
};

/** Unread counts shown on the tab bar, rail and sidebar (GET /v1/me/badges, B11). */
export function useBadges(): Partial<Record<string, number>> {
  const signedIn = useSession((s) => s.status === 'signedIn' && !!s.me);
  const badges = useQuery({
    queryKey: qk.badges,
    queryFn: () => api.get<BadgesDto>('/v1/me/badges'),
    enabled: signedIn,
    refetchInterval: 120_000,
  });
  return {
    profile: badges.data?.notificationsUnread || undefined,
    messages: badges.data?.messagesUnread || undefined,
  };
}
