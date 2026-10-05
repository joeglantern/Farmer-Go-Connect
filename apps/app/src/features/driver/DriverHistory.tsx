import type { DriverRouteItemDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { dateLong, timeShort } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Card, Pill, Segmented } from '../../ui/Controls';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { routeStatusView, useDriverRoutes } from './data';

type Scope = 'COMPLETED' | 'all';

/** The driver's past routes, grouped by day, newest first (GET /v1/driver/routes). */
export function DriverHistory() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const [scope, setScope] = useState<Scope>('COMPLETED');
  const routes = useDriverRoutes(scope === 'all' ? undefined : scope);

  const sections = useMemo(() => {
    const map = new Map<string, DriverRouteItemDto[]>();
    for (const r of routes.data?.pages.flatMap((p) => p.items) ?? []) {
      const day = r.date.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), r]);
    }
    return [...map.entries()].map(([day, data]) => ({ day, data }));
  }, [routes.data]);
  const maxWidth = size === 'compact' ? undefined : 760;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('driver.historyTitle')} back={false} large />
      <View style={[styles.col, { maxWidth }]}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'COMPLETED', label: tr('driver.routeStatus.COMPLETED') },
              { value: 'all', label: tr('driver.allRoutes') },
            ]}
          />
        </View>
        {routes.isLoading ? (
          <View style={{ paddingHorizontal: 20 }}>
            <SkeletonList count={5} height={96} />
          </View>
        ) : routes.error ? (
          <ErrorState onRetry={() => void routes.refetch()} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
            refreshing={routes.isRefetching}
            onRefresh={() => void routes.refetch()}
            onEndReached={() =>
              routes.hasNextPage && !routes.isFetchingNextPage && void routes.fetchNextPage()
            }
            onEndReachedThreshold={0.4}
            renderSectionHeader={({ section }) => (
              <Text variant="calloutStrong" style={styles.sectionHead}>
                {dateLong(section.day)}
              </Text>
            )}
            renderItem={({ item }) => <HistoryRoute route={item} />}
            ListEmptyComponent={
              <EmptyState
                art="noRoutes"
                title={tr('driver.noHistoryTitle')}
                body={tr('driver.noHistoryBody')}
                action={{
                  label: tr('driver.todaysRoutes'),
                  onPress: () => router.navigate('/home'),
                  icon: 'truck',
                }}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

function HistoryRoute({ route }: { route: DriverRouteItemDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const s = routeStatusView(route.status);
  const pct = route.stopsTotal ? route.stopsDone / route.stopsTotal : 0;
  return (
    <Card
      onPress={() => router.push({ pathname: '/route/[id]', params: { id: route.id } })}
      accessibilityLabel={`${route.code}, ${tr(s.labelKey)}`}
      style={{ gap: 10, marginBottom: 10 }}
    >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{route.code}</Text>
          <Text variant="caption" tone="secondary" numeric>
            {[
              route.county,
              route.distanceKm != null ? `${Math.round(route.distanceKm)} km` : null,
              route.completedAt ? tr('driver.finishedAt', { time: timeShort(route.completedAt) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
      </View>
      <View style={[styles.bar, { backgroundColor: t.colors.surfaceMuted }]}>
        <View
          style={[styles.bar, { width: `${Math.round(pct * 100)}%`, backgroundColor: t.colors.primary }]}
        />
      </View>
      <Text variant="calloutStrong" numeric>
        {tr('driver.stopsProgress', { done: route.stopsDone, total: route.stopsTotal })}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  col: { flex: 1, width: '100%', alignSelf: 'center' },
  sectionHead: { paddingTop: 16, paddingBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
