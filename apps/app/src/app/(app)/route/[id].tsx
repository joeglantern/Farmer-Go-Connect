import type { RouteStopDto } from '@farmgo/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { joinChannel } from '../../../data/realtime';
import {
  deliveryWindow,
  loadSummary,
  orderedStops,
  routeStatusView,
  stopStatusView,
  useDriverAction,
  useRouteDetail,
} from '../../../features/driver/data';
import { LiveBadge } from '../../../features/driver/LiveBadge';
import { useLocationSharing } from '../../../features/driver/useLocationSharing';
import LeafletMap, { type MapMarker } from '../../../features/maps/LeafletMap';
import { openDirections } from '../../../features/qa/data';
import { Stat } from '../../../features/qa/QaTasks';
import { humanError } from '../../../lib/errors';
import { dateLong, qty, timeShort, unitLabel } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button, IconButton } from '../../../ui/Button';
import { Pill } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Pressable } from '../../../ui/Pressable';
import { Header, Screen, SectionTitle } from '../../../ui/Screen';
import { Skeleton, SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

/** A driver's route: ordered stops, start button, live location while driving. */
export default function RouteScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const route = useRouteDetail(id);
  const action = useDriverAction(id);
  const r = route.data;
  const live = useLocationSharing(r?.status === 'IN_PROGRESS' ? r.id : null);

  useEffect(() => (id ? joinChannel(`route:${id}`) : undefined), [id]);

  const header = (
    <Header title={r?.code ?? tr('driver.routeTitle')} subtitle={r ? dateLong(r.date) : undefined} />
  );

  if (route.isLoading) {
    return (
      <Screen header={header}>
        <View style={{ gap: 16 }}>
          <Skeleton height={96} radius={14} />
          <SkeletonList count={4} height={96} />
        </View>
      </Screen>
    );
  }
  if (route.error || !r) {
    return (
      <Screen header={header}>
        {route.error ? (
          <ErrorState onRetry={() => void route.refetch()} message={humanError(route.error)} />
        ) : (
          <EmptyState
            art="noRoutes"
            title={tr('driver.routeGone')}
            action={{ label: tr('driver.backToToday'), onPress: () => router.back(), icon: 'back' }}
          />
        )}
      </Screen>
    );
  }

  const stops = orderedStops(r);
  const finished = stops.filter((s) => s.status !== 'PENDING' && s.status !== 'ARRIVED').length;
  const next = stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED');
  const status = routeStatusView(r.status);
  const wide = size === 'expanded';

  const start = async () => {
    const ok = await dialog.confirm({
      title: tr('driver.startTitle'),
      message: tr('driver.startBody', { count: stops.length }),
      confirmLabel: tr('driver.startRoute'),
      icon: 'truck',
    });
    if (!ok) return;
    action.mutate(
      { kind: 'start' },
      {
        onSuccess: () => toast.success(tr('driver.started')),
        onError: (e) => toast.error(humanError(e)),
      },
    );
  };

  const markers: MapMarker[] = [
    ...stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        id: s.id,
        lat: s.lat!,
        lng: s.lng!,
        kind: s.kind === 'PICKUP' ? ('farm' as const) : ('buyer' as const),
        label: `${s.sequence}. ${s.kind === 'PICKUP' ? (s.address ?? s.order.code) : s.order.buyerOrg.name}`,
      })),
    ...(r.lastLocation
      ? [
          {
            id: 'me',
            lat: r.lastLocation.lat,
            lng: r.lastLocation.lng,
            kind: 'driver' as const,
            label: tr('driver.you'),
          },
        ]
      : []),
  ];

  const footer =
    r.status === 'PLANNED' ? (
      <Button
        label={tr('driver.startRoute')}
        icon="truck"
        size="lg"
        loading={action.isPending}
        onPress={() => void start()}
      />
    ) : r.status === 'IN_PROGRESS' && next ? (
      <View style={styles.footerRow}>
        <Button
          label={tr('driver.navigate')}
          variant="secondary"
          icon="navigate"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => openDirections(next.lat, next.lng, next.address ?? next.order.buyerOrg.name)}
        />
        <Button
          label={tr('driver.openStopN', { n: next.sequence })}
          size="lg"
          iconRight="forward"
          style={{ flex: 1.2 }}
          onPress={() => router.push({ pathname: '/stop/[id]', params: { id: next.id, routeId: r.id } })}
        />
      </View>
    ) : undefined;

  const overview = (
    <View style={{ gap: 16 }}>
      <View style={styles.statusRow}>
        <Pill label={tr(status.labelKey)} tone={status.tone} />
        {r.vehicle && <Pill label={r.vehicle} icon="truck" />}
        <LiveBadge state={live.state === 'denied' || live.state === 'error' ? 'off' : live.state} />
      </View>
      {(live.state === 'denied' || live.state === 'error') && <LiveBadge state={live.state} />}
      <View style={styles.stats}>
        <Stat label={tr('driver.stops')} value={`${finished}/${stops.length}`} icon="route" />
        <Stat
          label={tr('driver.distance')}
          value={r.distanceKm != null ? `${Math.round(r.distanceKm)} km` : '·'}
          icon="navigate"
        />
      </View>
      {r.status === 'COMPLETED' && <Banner tone="success" message={tr('driver.routeDone')} />}
      {markers.length > 0 && (
        <View style={{ borderRadius: t.radius.lg, overflow: 'hidden' }}>
          <LeafletMap
            markers={markers}
            dark={t.scheme === 'dark'}
            height={wide ? 420 : 220}
            dom={{ scrollEnabled: false, matchContents: true }}
          />
        </View>
      )}
    </View>
  );

  return (
    <Screen
      header={header}
      footer={footer}
      refreshing={route.isRefetching}
      onRefresh={() => void route.refetch()}
    >
      <View style={[{ gap: 24 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={wide ? { width: 440 } : undefined}>{overview}</View>
        <View style={{ flex: 1, gap: 12 }}>
          <SectionTitle title={tr('driver.stopsInOrder')} />
          {stops.length === 0 ? (
            <EmptyState compact art="noRoutes" title={tr('driver.noStops')} />
          ) : (
            stops.map((s, i) => (
              <StopRow
                key={s.id}
                stop={s}
                routeId={r.id}
                last={i === stops.length - 1}
                current={s.id === next?.id}
                canOpen={r.status !== 'PLANNED'}
              />
            ))
          )}
        </View>
      </View>
    </Screen>
  );
}

function StopRow({
  stop,
  routeId,
  last,
  current,
  canOpen,
}: {
  stop: RouteStopDto;
  routeId: string;
  last: boolean;
  current: boolean;
  canOpen: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const s = stopStatusView(stop.status);
  const pickup = stop.kind === 'PICKUP';
  const win = deliveryWindow(stop.order.deliveryWindow);
  const done = stop.status === 'COMPLETED';
  const failed = stop.status === 'FAILED' || stop.status === 'SKIPPED';
  const dotColor = done
    ? t.colors.success
    : failed
      ? t.colors.danger
      : current
        ? t.colors.primary
        : t.colors.lineStrong;
  const title = pickup ? (stop.address ?? stop.order.code) : stop.order.buyerOrg.name;

  return (
    <View style={styles.stopRow}>
      <View style={styles.rail}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor: done || failed || current ? dotColor : t.colors.surface,
              borderColor: dotColor,
            },
          ]}
        >
          {done ? (
            <Icon name="check" size={14} color="#FFFFFF" weight="bold" />
          ) : failed ? (
            <Icon name="close" size={14} color="#FFFFFF" weight="bold" />
          ) : (
            <Text variant="micro" numeric style={{ color: current ? '#FFFFFF' : t.colors.textSecondary }}>
              {stop.sequence}
            </Text>
          )}
        </View>
        {!last && (
          <View style={[styles.line, { backgroundColor: done ? t.colors.success : t.colors.line }]} />
        )}
      </View>
      <Pressable
        onPress={
          canOpen
            ? () => router.push({ pathname: '/stop/[id]', params: { id: stop.id, routeId } })
            : undefined
        }
        disabled={!canOpen}
        accessibilityRole="button"
        accessibilityLabel={`${tr(pickup ? 'driver.pickup' : 'driver.dropoff')} ${stop.sequence}, ${title}, ${tr(s.labelKey)}`}
        accessibilityHint={canOpen ? undefined : tr('driver.startFirst')}
        focusRadius={t.radius.md}
        style={({ pressed }) => [
          styles.stopCard,
          {
            borderRadius: t.radius.md,
            backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
            borderColor: current ? t.colors.primary : t.colors.line,
            borderWidth: current ? 1.5 : 1,
            opacity: failed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.stopHead}>
          <Icon
            name={pickup ? 'farm' : 'building'}
            size={18}
            color={pickup ? t.colors.leaf : t.colors.primary}
            weight="duotone"
          />
          <Text variant="micro" tone="secondary" style={{ flex: 1 }}>
            {tr(pickup ? 'driver.pickup' : 'driver.dropoff').toUpperCase()}
            {stop.eta ? `  ·  ${tr('driver.eta')} ${timeShort(stop.eta)}` : ''}
          </Text>
          <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
        </View>
        <Text variant="headline" numberOfLines={2}>
          {title}
        </Text>
        {!pickup && stop.address && (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {stop.address}
          </Text>
        )}
        {win && (
          <View style={styles.windowRow}>
            <Icon name="clock" size={14} color={t.colors.primary} />
            <Text variant="calloutStrong" tone="brand" numeric>
              {tr('driver.window', win)}
            </Text>
          </View>
        )}
        <Text variant="caption" tone="tertiary" numberOfLines={2}>
          {stop.order.code} · {loadSummary(stop, unitLabel, qty)}
        </Text>
      </Pressable>
      {canOpen && !done && !failed && (
        <IconButton
          icon="navigate"
          label={tr('driver.navigate')}
          variant="tinted"
          onPress={() => openDirections(stop.lat, stop.lng, title)}
          style={{ alignSelf: 'center' }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 12 },
  footerRow: { flexDirection: 'row', gap: 10 },
  stopRow: { flexDirection: 'row', gap: 12 },
  rail: { width: 28, alignItems: 'center' },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  line: { flex: 1, width: 2, marginTop: 4, marginBottom: -12 },
  stopCard: { flex: 1, padding: 14, gap: 4, marginBottom: 12 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
