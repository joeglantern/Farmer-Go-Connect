import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { type Conversation, useConversations } from '../../../data/conversations';
import { statusView } from '../../../data/orders';
import { useSession } from '../../../data/session';
import { ChatThread } from '../../../features/chat/ChatThread';
import { timeAgo } from '../../../lib/format';
import { useRole } from '../../../nav/Shell';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Avatar, Pill } from '../../../ui/Controls';
import { Pressable } from '../../../ui/Pressable';
import { Header } from '../../../ui/Screen';
import { SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { SearchField } from '../../../ui/TextField';

/** Messages inbox: one thread per order. Tablets and desktop show the thread beside the list. */
export default function Messages() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const role = useRole();
  const perspective =
    role === 'farmer' || role === 'agent'
      ? 'farmer'
      : role === 'buyer' || role === 'user'
        ? 'buyer'
        : 'staff';
  const threads = useConversations(perspective);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const split = size !== 'compact';

  const items = useMemo(() => {
    const all = threads.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (c) => c.other.name.toLowerCase().includes(needle) || c.orderCode.toLowerCase().includes(needle),
    );
  }, [threads.data, q]);

  const current = split ? (selected ?? items[0]?.orderId ?? null) : null;

  const list = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SearchField value={q} onChangeText={setQ} placeholder={tr('inbox.search')} />
      </View>
      {threads.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <SkeletonList count={6} height={68} />
        </View>
      ) : threads.error ? (
        <ErrorState onRetry={() => threads.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.orderId}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
          refreshing={threads.isRefetching}
          onRefresh={() => threads.refetch()}
          renderItem={({ item }) => (
            <ThreadRow
              c={item}
              perspective={perspective}
              selected={item.orderId === current}
              onPress={() =>
                split
                  ? setSelected(item.orderId)
                  : router.push({ pathname: '/chat/[orderId]', params: { orderId: item.orderId } })
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              art="noMessages"
              title={q ? tr('inbox.noMatch') : tr('inbox.emptyTitle')}
              body={
                q ? undefined : perspective === 'farmer' ? tr('inbox.emptyFarmer') : tr('inbox.emptyBuyer')
              }
            />
          }
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('tabs.messages')} back={false} large={!split} />
      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: size === 'expanded' ? 380 : 320,
              borderRightWidth: 1,
              borderRightColor: t.colors.line,
            }}
          >
            {list}
          </View>
          <View style={{ flex: 1 }}>
            {current ? (
              <ChatThread key={current} orderId={current} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="callout" tone="tertiary">
                  {tr('inbox.pick')}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </View>
  );
}

function ThreadRow({
  c,
  perspective,
  selected,
  onPress,
}: {
  c: Conversation;
  perspective: 'buyer' | 'farmer' | 'staff';
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const me = useSession((s) => s.me);
  const s = statusView(c.orderStatus, perspective === 'farmer' ? 'farmer' : 'buyer');
  const unread = c.unreadCount > 0;
  const last = c.lastMessage;
  const preview = last
    ? `${last.authorId === me?.user.id ? `${tr('inbox.you')}: ` : ''}${last.body || (last.hasPhotos ? tr('chat.photo') : '')}`
    : tr('inbox.noMessagesYet');
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${c.other.name}, ${c.orderCode}, ${preview}${unread ? `, ${tr('inbox.unread', { count: c.unreadCount })}` : ''}`}
      accessibilityState={{ selected }}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.row,
        {
          borderRadius: t.radius.md,
          backgroundColor: selected
            ? t.colors.primaryTint
            : pressed || hovered
              ? t.colors.surfaceMuted
              : 'transparent',
        },
      ]}
    >
      <Avatar uri={c.other.avatarUrl} name={c.other.name} size={48} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.top}>
          <Text variant={unread ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flex: 1 }}>
            {c.other.name}
          </Text>
          <Text variant="caption" tone={unread ? 'brand' : 'tertiary'}>
            {timeAgo(last?.createdAt ?? c.updatedAt)}
          </Text>
        </View>
        <View style={styles.top}>
          <Text
            variant="callout"
            tone={unread ? 'default' : 'secondary'}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {preview}
          </Text>
          {unread && (
            <View style={[styles.badge, { backgroundColor: t.colors.primary }]}>
              <Text variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }} numeric>
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="caption" tone="tertiary" numeric>
            {c.orderCode}
          </Text>
          <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 10, alignItems: 'flex-start' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
