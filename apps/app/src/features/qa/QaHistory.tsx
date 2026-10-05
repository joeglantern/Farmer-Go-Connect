import type { InspectionHistoryItemDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { produceName, qty, timeAgo, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Pill, Segmented } from '../../ui/Controls';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { OrderDetail } from '../orders/OrderDetail';
import { useQaHistory } from './data';

/** The officer's past inspections (GET /v1/qa/inspections), passed or failed. */
export function QaHistory() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const [passed, setPassed] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const history = useQaHistory(passed);
  const split = size !== 'compact';

  const items = useMemo(() => {
    const all = history.data?.pages.flatMap((p) => p.items) ?? [];
    const n = q.trim().toLowerCase();
    if (!n) return all;
    return all.filter((i) => {
      const o = i.orderItem;
      return (
        o.order.code.toLowerCase().includes(n) ||
        o.order.buyerOrg.name.toLowerCase().includes(n) ||
        o.listing.farm.name.toLowerCase().includes(n) ||
        o.listing.produce.name.toLowerCase().includes(n) ||
        o.listing.produce.nameSw.toLowerCase().includes(n)
      );
    });
  }, [history.data, q]);
  const current = split ? (selected ?? items[0]?.id ?? null) : null;
  const currentOrder = items.find((i) => i.id === current)?.orderItem.order.id ?? null;

  const list = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, gap: 12, paddingBottom: 12 }}>
        <Segmented
          value={passed ? 'passed' : 'failed'}
          onChange={(v) => {
            setPassed(v === 'passed');
            setSelected(null);
          }}
          options={[
            { value: 'passed', label: tr('qa.passed') },
            { value: 'failed', label: tr('qa.failed') },
          ]}
        />
        <SearchField value={q} onChangeText={setQ} placeholder={tr('qa.searchHistory')} />
      </View>
      {history.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <SkeletonList count={5} height={96} />
        </View>
      ) : history.error ? (
        <ErrorState onRetry={() => void history.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 10 }}
          refreshing={history.isRefetching}
          onRefresh={() => void history.refetch()}
          onEndReached={() =>
            history.hasNextPage && !history.isFetchingNextPage && void history.fetchNextPage()
          }
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <InspectionRow
              item={item}
              selected={item.id === current}
              onPress={() =>
                split
                  ? setSelected(item.id)
                  : router.push({ pathname: '/order/[id]', params: { id: item.orderItem.order.id } })
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              art="noOrders"
              title={q ? tr('qa.noHistoryMatch') : tr('qa.noHistoryTitle')}
              body={q ? undefined : tr('qa.noHistoryBody')}
              action={
                q
                  ? { label: tr('qa.clearSearch'), onPress: () => setQ(''), icon: 'close' }
                  : { label: tr('qa.openTasks'), onPress: () => router.navigate('/home'), icon: 'shield' }
              }
            />
          }
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('qa.historyTitle')} back={false} large={!split} />
      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: size === 'expanded' ? 420 : 340,
              borderRightWidth: 1,
              borderRightColor: t.colors.line,
            }}
          >
            {list}
          </View>
          <View style={{ flex: 1 }}>
            {currentOrder ? (
              <OrderDetail id={currentOrder} embedded />
            ) : (
              <View style={styles.center}>
                <Text variant="callout" tone="tertiary">
                  {tr('qa.pickOne')}
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

function InspectionRow({
  item,
  selected,
  onPress,
}: {
  item: InspectionHistoryItemDto;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { listing, order } = item.orderItem;
  const unit = listing.produce.unit;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${produceName(listing.produce)}, ${listing.farm.name}, ${item.passed ? tr('qa.passed') : tr('qa.failed')}`}
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
              : t.colors.surface,
          borderColor: selected ? t.colors.primary : t.colors.line,
        },
      ]}
    >
      <View style={styles.top}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {produceName(listing.produce)}
        </Text>
        <Pill
          label={tr('qa.gradeN', { grade: item.grade })}
          tone={item.passed ? 'success' : 'danger'}
          icon={item.passed ? 'checkCircle' : 'error'}
          size="sm"
        />
      </View>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {listing.farm.name}, {listing.farm.county} · {order.buyerOrg.name}
      </Text>
      <Text variant="caption" tone="tertiary" numeric numberOfLines={2}>
        {[
          tr('qa.acceptedOf', {
            accepted: `${qty(item.acceptedQty)} ${unitLabel(unit, item.acceptedQty)}`,
            total: `${qty(item.orderItem.quantity)} ${unitLabel(unit, item.orderItem.quantity)}`,
          }),
          item.rejectReason,
          `${order.code} · ${timeAgo(item.inspectedAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { padding: 14, gap: 4, borderWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
