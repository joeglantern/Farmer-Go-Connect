import type { RouteStopDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { qty, timeShort, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Header, Screen, SectionTitle } from '../../ui/Screen';
import { Skeleton, SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { openDirections } from '../qa/data';
import { Stat } from '../qa/QaTasks';
import {
  type DashboardRoute,
  deliveryWindow,
  loadSummary,
  routeStatusView,
  useDriverDashboard,
  useRouteDetail,
} from './data';
import { LiveBadge } from './LiveBadge';
import { useLocationSharing } from './useLocationSharing';

const rank = (r: DashboardRoute) => (r.status === 'IN_PROGRESS' ? 0 : r.status === 'PLANNED' ? 1 : 2);

/** Driver home: today's routes from the driver dashboard, the next stop front and centre. */
export function DriverToday() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const dash = useDriverDashboard();
  const list = useMemo(() => [...(dash.data?.routes ?? [])].sort((a, b) => rank(a) - rank(b)), [dash.data]);
  const active =
    list.find((r) => r.status === 'IN_PROGRESS' && r.nextStop) ??
    list.find((r) => r.status === 'PLANNED' && r.nextStop) ??
    null;
  // The dashboard names the next stop; the route detail adds its load, buyer and coordinates.
  const detail = useRouteDetail(active?.id);
  const next = detail.data?.stops.find((s) => s.id === active?.nextStop?.id) ?? null;
  const live = useLocationSharing(active?.status === 'IN_PROGRESS' ? active.id : null);
  const firstName = me?.user.name.split(' ')[0] ?? '';
  const wide = size !== 'compact';
  const stopsTotal = list.reduce((s, r) => s + r.stopsTotal, 0);
  const stopsDone = list.reduce((s, r) => s + r.stopsDone, 0);

  return (
    <Screen
      header={
        <Header
          title={tr('driver.hello', { name: firstName })}
          subtitle={tr('driver.todaySubtitle')}
          back={false}
          large
        />
      }
      refreshing={dash.isRefetching}
      onRefresh={() => {
        void dash.refetch();
        if (active) void detail.refetch();
      }}
    >
      {dash.isLoading ? (
        <SkeletonList count={3} height={150} />
      ) : dash.error ? (
        <ErrorState onRetry={() => void dash.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          art="noRoutes"
          title={tr('driver.noRoutesTitle')}
          body={tr('driver.noRoutesBody')}
          action={{ label: tr('driver.checkAgain'), onPress: () => void dash.refetch(), icon: 'refresh' }}
        />
      ) : (
        <View style={{ gap: 20 }}>
          <LiveBadge state={live.state} />
          <View style={styles.stats}>
            <Stat label={tr('driver.routesToday')} value={String(list.length)} icon="route" />
            <Stat label={tr('driver.stopsToday')} value={String(stopsTotal)} icon="location" />
            <Stat label={tr('driver.stopsDone')} value={`${stopsDone}/${stopsTotal}`} icon="checkCircle" />
          </View>

          <View style={[{ gap: 20 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
            {active && (
              <View style={[{ gap: 12 }, wide && { flex: 1.1 }]}>
                <SectionTitle title={tr('driver.nextStop')} />
                {next ? (
                  <NextStopCard route={active} stop={next} />
                ) : detail.error ? (
                  <ErrorState compact onRetry={() => void detail.refetch()} />
                ) : (
                  <Skeleton height={230} radius={18} />
                )}
              </View>
            )}
            <View style={[{ gap: 12 }, wide && { flex: 1 }]}>
              <SectionTitle title={tr('driver.yourRoutes')} />
              {list.map((r) => (
                <RouteCard key={r.id} route={r} />
              ))}
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

function NextStopCard({ route, stop }: { route: DashboardRoute; stop: RouteStopDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const pickup = stop.kind === 'PICKUP';
  const started = route.status === 'IN_PROGRESS';
  const win = deliveryWindow(stop.order.deliveryWindow);
  return (
    <View
      style={[styles.next, { backgroundColor: t.colors.band, borderRadius: t.radius.lg }, t.elevation.raised]}
    >
      <View style={styles.nextHead}>
        <View style={[styles.kindIcon, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
          <Icon name={pickup ? 'farm' : 'building'} size={24} color={t.colors.accentLime} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="micro" tone="onBrandMuted">
            {tr(pickup ? 'driver.pickupN' : 'driver.dropoffN', { n: stop.sequence })}
          </Text>
          <Text variant="title2" tone="onBrand" numberOfLines={2}>
            {pickup ? (stop.address ?? stop.order.code) : stop.order.buyerOrg.name}
          </Text>
        </View>
        {stop.eta && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="micro" tone="onBrandMuted">
              {tr('driver.eta')}
            </Text>
            <Text variant="title3" tone="onBrand" numeric>
              {timeShort(stop.eta)}
            </Text>
          </View>
        )}
      </View>
      {!pickup && stop.address && (
        <Text variant="callout" tone="onBrandMuted" numberOfLines={2}>
          {stop.address}
        </Text>
      )}
      {win && (
        <View style={styles.windowRow}>
          <Icon name="clock" size={16} color={t.colors.accentLime} />
          <Text variant="calloutStrong" tone="onBrand" numeric>
            {tr('driver.window', win)}
          </Text>
        </View>
      )}
      <Text variant="callout" tone="onBrand" numberOfLines={3}>
        {loadSummary(stop, unitLabel, qty)}
      </Text>
      <View style={styles.nextActions}>
        <Button
          label={tr('driver.navigate')}
          variant="onBrand"
          icon="navigate"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => openDirections(stop.lat, stop.lng, stop.address ?? stop.order.buyerOrg.name)}
        />
        <Button
          label={started ? tr('driver.openStop') : tr('driver.openRoute')}
          size="lg"
          iconRight="forward"
          style={{ flex: 1 }}
          onPress={() =>
            started
              ? router.push({ pathname: '/stop/[id]', params: { id: stop.id, routeId: route.id } })
              : router.push({ pathname: '/route/[id]', params: { id: route.id } })
          }
        />
      </View>
    </View>
  );
}

function RouteCard({ route }: { route: DashboardRoute }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const pct = route.stopsTotal ? route.stopsDone / route.stopsTotal : 0;
  const s = routeStatusView(route.status);
  const nextLabel = route.nextStop
    ? `${tr(route.nextStop.kind === 'PICKUP' ? 'driver.pickup' : 'driver.dropoff')}${route.nextStop.address ? `: ${route.nextStop.address}` : ''}`
    : null;
  return (
    <Card
      onPress={() => router.push({ pathname: '/route/[id]', params: { id: route.id } })}
      accessibilityLabel={`${route.code}, ${tr(s.labelKey)}`}
      style={{ gap: 12 }}
    >
      <View style={styles.routeHead}>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{route.code}</Text>
          <Text variant="caption" tone="secondary">
            {[route.county, route.distanceKm != null ? `${Math.round(route.distanceKm)} km` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
      </View>
      <View style={[styles.bar, { backgroundColor: t.colors.surfaceMuted }]}>
        <View
          style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: t.colors.primary }]}
        />
      </View>
      <Text variant="calloutStrong" numeric>
        {tr('driver.stopsProgress', { done: route.stopsDone, total: route.stopsTotal })}
      </Text>
      {nextLabel && (
        <View style={styles.nextRow}>
          <Icon name="flag" size={14} color={t.colors.textTertiary} />
          <Text variant="caption" tone="tertiary" numberOfLines={1} style={{ flex: 1 }}>
            {tr('driver.nextIs', { stop: nextLabel })}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 12 },
  next: { padding: 20, gap: 14 },
  nextHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  routeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
