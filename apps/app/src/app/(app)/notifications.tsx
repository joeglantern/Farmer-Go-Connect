import type { DeepLink, NotificationDto, NotificationPageDto } from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';
import { hrefForLink, linkFromData } from '../../lib/deeplink';
import { humanError } from '../../lib/errors';
import { timeAgo } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

function iconFor(type: string): IconName {
  if (type.startsWith('payment') || type.startsWith('payout')) return 'wallet';
  if (type.startsWith('route') || type.startsWith('delivery')) return 'truck';
  if (type.startsWith('match')) return 'handshake';
  if (type.startsWith('demand')) return 'megaphone';
  if (type.startsWith('qa') || type.includes('inspect')) return 'shield';
  if (type.includes('message')) return 'chat';
  if (type.startsWith('dispute')) return 'flag';
  if (type.startsWith('order')) return 'orders';
  return 'bell';
}

/** Where tapping a notification goes: the typed link (B14), else the older id-based data. */
function linkFor(n: NotificationDto, role?: string | null): Href | null {
  const typed = hrefForLink(
    (n as NotificationDto & { link?: DeepLink | null }).link ?? linkFromData(n.data),
    role,
  );
  if (typed) return typed;
  const d = (n.data ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  if (s('orderId')) return { pathname: '/order/[id]', params: { id: s('orderId')! } };
  return null;
}

export default function Notifications() {
  const t = useTheme();
  const role = useSession((st) => st.me?.user.role);
  const { t: tr } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<NotificationPageDto>('/v1/notifications', { cursor: pageParam, limit: 30 }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const markRead = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api.post('/v1/notifications/read', body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    const href = linkFor(n, role);
    if (href) router.push(href);
  };

  const readAll = async () => {
    try {
      await markRead.mutateAsync({ all: true });
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('notifications.title')}
        right={
          unread > 0 ? (
            <Button label={tr('notifications.markAll')} variant="ghost" size="sm" onPress={readAll} />
          ) : undefined
        }
      />
      {list.isLoading ? (
        <View style={{ padding: 20 }}>
          <SkeletonList count={6} height={64} />
        </View>
      ) : list.error ? (
        <ErrorState onRetry={() => list.refetch()} message={humanError(list.error)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: 32,
            width: '100%',
            maxWidth: 760,
            alignSelf: 'center',
          }}
          refreshing={list.isRefetching}
          onRefresh={() => list.refetch()}
          onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              art="noNotifications"
              title={tr('notifications.emptyTitle')}
              body={tr('notifications.emptyBody')}
            />
          }
          renderItem={({ item: n }) => {
            const fresh = !n.readAt;
            return (
              <Pressable
                onPress={() => open(n)}
                accessibilityLabel={`${n.title}. ${n.body}. ${timeAgo(n.createdAt)}${fresh ? `. ${tr('notifications.unread')}` : ''}`}
                focusRadius={t.radius.md}
                style={({ pressed, hovered }) => [
                  styles.row,
                  {
                    borderRadius: t.radius.md,
                    backgroundColor:
                      pressed || hovered
                        ? t.colors.surfaceMuted
                        : fresh
                          ? t.colors.primaryTint
                          : 'transparent',
                  },
                ]}
              >
                <View
                  style={[styles.icon, { backgroundColor: fresh ? t.colors.surface : t.colors.surfaceMuted }]}
                >
                  <Icon name={iconFor(n.type)} size={20} color={t.colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                    <Text variant={fresh ? 'bodyStrong' : 'body'} style={{ flex: 1 }} numberOfLines={2}>
                      {n.title}
                    </Text>
                    <Text variant="caption" tone="tertiary">
                      {timeAgo(n.createdAt)}
                    </Text>
                  </View>
                  <Text variant="callout" tone="secondary" numberOfLines={3}>
                    {n.body}
                  </Text>
                </View>
                {fresh ? <View style={[styles.dot, { backgroundColor: t.colors.primary }]} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'flex-start', marginBottom: 4 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
});
