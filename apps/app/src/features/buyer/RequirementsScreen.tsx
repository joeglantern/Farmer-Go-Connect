import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { produceName, qty, relativeDay, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { type Requirement, type RequirementFilter, useBuyerDashboard, useRequirements } from './data';
import { repeatLabel } from './requirements';
import { StatusTag } from './StatusTag';

/** The buyer's requirements (demand): what they need, when, and how often. */
export function RequirementsScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const [filter, setFilter] = useState<RequirementFilter>('open');
  const list = useRequirements(filter);
  const dash = useBuyerDashboard();
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const gutter = size === 'compact' ? 20 : 32;
  const columns = size === 'expanded' ? 2 : 1;
  const upcoming = dash.data?.upcomingRequirements ?? [];

  const add = (
    <Button
      label={tr('requirements.new')}
      icon="plus"
      size="sm"
      fullWidth={false}
      onPress={() => router.push('/requirements/new')}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('requirements.title')} subtitle={tr('requirements.subtitle')} right={add} />
      <FlatList
        key={`cols-${columns}`}
        data={rows}
        numColumns={columns}
        keyExtractor={(d) => d.id}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 32,
          gap: 12,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
        }}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => {
          void list.refetch();
          void dash.refetch();
        }}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 4 }}>
            {filter === 'open' && upcoming.length > 0 && (
              <Card style={{ gap: 10, backgroundColor: t.colors.primaryTint }} elevated={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="calendar" size={18} color={t.colors.primary} />
                  <Text variant="headline">{tr('requirements.comingUp')}</Text>
                </View>
                {upcoming.slice(0, 4).map((u) => (
                  <View key={u.id} style={styles.upcoming}>
                    <Text variant="callout" style={{ flex: 1 }} numberOfLines={1}>
                      {u.produceName} · {qty(u.quantity)}
                    </Text>
                    <Text variant="calloutStrong" tone="brand">
                      {relativeDay(u.neededBy)}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
            <View style={{ maxWidth: 620 }}>
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'open', label: tr('requirements.filter.open') },
                  { value: 'paused', label: tr('requirements.filter.paused') },
                  { value: 'recurring', label: tr('requirements.filter.recurring') },
                  { value: 'closed', label: tr('requirements.filter.closed') },
                ]}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 / columns }}>
            <RequirementCard item={item} />
          </View>
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <SkeletonList count={4} height={104} />
          ) : list.error ? (
            <ErrorState message={humanError(list.error)} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              art="noMatches"
              title={tr(`requirements.empty.${filter}`)}
              body={tr('requirements.emptyBody')}
              action={{
                label: tr('requirements.new'),
                icon: 'plus',
                onPress: () => router.push('/requirements/new'),
              }}
            />
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} /> : null}
      />
    </View>
  );
}

function RequirementCard({ item: d }: { item: Requirement }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const repeat = repeatLabel(d.recurrence, d.neededBy);
  const filled = d.quantity > 0 ? Math.min(1, d.quantityFilled / d.quantity) : 0;
  return (
    <Card
      onPress={() => router.push({ pathname: '/requirements/[id]', params: { id: d.id } })}
      accessibilityLabel={tr('requirements.cardLabel', {
        name: produceName(d.produce),
        qty: qty(d.quantity),
        unit: unitLabel(d.produce.unit, d.quantity),
        date: relativeDay(d.neededBy),
      })}
      style={{ gap: 10 }}
    >
      <View style={styles.head}>
        <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
          {produceName(d.produce)}
        </Text>
        <StatusTag status={d.status} />
      </View>
      <Text variant="callout" numeric>
        {tr('requirements.qtyBy', {
          qty: qty(d.quantity),
          unit: unitLabel(d.produce.unit, d.quantity),
          date: relativeDay(d.neededBy),
        })}
      </Text>
      <View style={[styles.bar, { backgroundColor: t.colors.surfaceMuted }]}>
        <View
          style={{
            width: `${filled * 100}%`,
            height: '100%',
            backgroundColor: t.colors.primary,
            borderRadius: 3,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text variant="caption" tone="secondary" numeric>
          {tr('requirements.filled', { qty: qty(d.quantityFilled), total: qty(d.quantity) })}
        </Text>
        {repeat && <Pill label={repeat} tone="info" icon="repeat" size="sm" />}
        {d._count.matches > 0 && (
          <Pill
            label={tr('requirements.matches', { count: d._count.matches })}
            tone="brand"
            icon="handshake"
            size="sm"
          />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  upcoming: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
