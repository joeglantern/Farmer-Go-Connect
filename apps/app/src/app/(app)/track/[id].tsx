import type { DriverLocationDto } from '@farmgo/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { trackingStep, useOrder, useTracking } from '../../../data/orders';
import { joinChannel, onRealtime } from '../../../data/realtime';
import LeafletMap, { type MapMarker } from '../../../features/maps/LeafletMap';
import { dateLong, timeShort } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button, IconButton } from '../../../ui/Button';
import { Avatar, Card } from '../../../ui/Controls';
import { Icon, type IconName } from '../../../ui/Icon';
import { Header } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

const STEPS: { key: string; icon: IconName }[] = [
  { key: 'orders.step.placed', icon: 'receipt' },
  { key: 'orders.step.processing', icon: 'basket' },
  { key: 'orders.step.outForDelivery', icon: 'truck' },
  { key: 'orders.step.delivered', icon: 'checkCircle' },
];

/** Track Order (mockup 8): progress, live map, driver card. */
export default function TrackOrder() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const tracking = useTracking(id);
  const [live, setLive] = useState<Pick<DriverLocationDto, 'lat' | 'lng' | 'recordedAt'> | null>(null);

  const routeId = tracking.data?.route?.id;
  useEffect(() => joinChannel(`order:${id}`), [id]);
  useEffect(() => (routeId ? joinChannel(`route:${routeId}`) : undefined), [routeId]);
  useEffect(
    () =>
      onRealtime((type, data) => {
        if (type !== 'delivery.location' || (routeId && data.routeId !== routeId)) return;
        const lat = Number(data.lat);
        const lng = Number(data.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng))
          setLive({ lat, lng, recordedAt: String(data.recordedAt ?? new Date().toISOString()) });
      }),
    [routeId],
  );

  const o = order.data;
  const tr_ = tracking.data;
  const loc = live ?? tr_?.lastLocation ?? null;

  const markers = useMemo<MapMarker[]>(() => {
    if (!o) return [];
    const m: MapMarker[] = [];
    const pickup = tr_?.stops.find((s) => s.kind === 'PICKUP' && s.orderId === o.id);
    const drop = tr_?.stops.find((s) => s.kind === 'DROPOFF' && s.orderId === o.id);
    if (pickup?.lat != null && pickup.lng != null)
      m.push({
        id: 'farm',
        lat: pickup.lat,
        lng: pickup.lng,
        kind: 'farm',
        label: o.items[0]?.listing.farm.name,
      });
    const dLat = drop?.lat ?? o.deliveryLat;
    const dLng = drop?.lng ?? o.deliveryLng;
    if (dLat != null && dLng != null)
      m.push({ id: 'buyer', lat: dLat, lng: dLng, kind: 'buyer', label: tr('track.you') });
    if (loc)
      m.push({
        id: 'driver',
        lat: loc.lat,
        lng: loc.lng,
        kind: 'driver',
        label: tr_?.route?.driver?.name ?? tr('track.driver'),
      });
    return m;
  }, [o, tr_, loc, tr]);

  if (order.isLoading || tracking.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header title={tr('track.title')} />
        <View style={{ padding: 20, gap: 16 }}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={300} radius={16} />
          <Skeleton height={88} radius={14} />
        </View>
      </View>
    );
  }
  if (!o || order.error) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header title={tr('track.title')} />
        <ErrorState onRetry={() => order.refetch()} />
      </View>
    );
  }

  const step = trackingStep(o.status);
  const drop = tr_?.stops.find((s) => s.kind === 'DROPOFF' && s.orderId === o.id);
  const driver = tr_?.route?.driver ?? null;
  const eta = drop?.eta ?? null;
  const wide = size !== 'compact';

  const progress = (
    <Card style={{ gap: 4 }}>
      {STEPS.map((s, i) => {
        const done = i < step || (i === 3 && step === 3);
        const current = i === step && i !== 3;
        const on = done || current;
        return (
          <View key={s.key} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={[
                  styles.node,
                  {
                    backgroundColor: on ? t.colors.primary : t.colors.surfaceMuted,
                    borderColor: on ? t.colors.primary : t.colors.line,
                  },
                ]}
              >
                <Icon
                  name={done ? 'check' : s.icon}
                  size={16}
                  color={on ? '#FFFFFF' : t.colors.textTertiary}
                  weight={done ? 'bold' : 'regular'}
                />
              </View>
              {i < STEPS.length - 1 && (
                <View
                  style={[styles.rail, { backgroundColor: i < step ? t.colors.primary : t.colors.line }]}
                />
              )}
            </View>
            <View style={{ flex: 1, paddingTop: 5, paddingBottom: i < STEPS.length - 1 ? 18 : 0, gap: 2 }}>
              <Text variant={current ? 'bodyStrong' : 'body'} tone={on ? 'default' : 'tertiary'}>
                {tr(s.key)}
              </Text>
              {current && (
                <Text variant="caption" tone="secondary">
                  {i === 2 && eta ? tr('track.arriving', { time: timeShort(eta) }) : tr(`track.detail.${i}`)}
                </Text>
              )}
              {i === 3 && done && o.deliveredAt && (
                <Text variant="caption" tone="secondary">
                  {tr('track.deliveredAt', { time: timeShort(o.deliveredAt) })}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );

  const map =
    markers.length > 0 ? (
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line }}>
        <LeafletMap
          markers={markers}
          dark={t.scheme === 'dark'}
          height={wide ? 460 : 300}
          dom={{ scrollEnabled: false, matchContents: true }}
        />
      </View>
    ) : (
      <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
        <Icon name="route" size={32} color={t.colors.textTertiary} />
        <Text variant="callout" tone="secondary" align="center">
          {tr('track.noMap')}
        </Text>
      </Card>
    );

  const driverCard = driver ? (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Avatar name={driver.name} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{driver.name}</Text>
        <Text variant="caption" tone="secondary">
          {tr('track.yourDriver')}
          {loc ? ` · ${tr('track.seen', { time: timeShort(loc.recordedAt) })}` : ''}
        </Text>
      </View>
      {driver.phoneNumber && (
        <IconButton
          icon="phone"
          label={tr('track.call', { name: driver.name })}
          variant="tinted"
          color={t.colors.primary}
          onPress={() => void Linking.openURL(`tel:${driver.phoneNumber}`)}
        />
      )}
      <IconButton
        icon="chat"
        label={tr('track.message')}
        variant="tinted"
        color={t.colors.primary}
        onPress={() => router.push({ pathname: '/chat/[orderId]', params: { orderId: o.id } })}
      />
    </Card>
  ) : (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={[
          styles.node,
          {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: t.colors.primaryTint,
            borderColor: 'transparent',
          },
        ]}
      >
        <Icon name="truck" size={22} color={t.colors.primary} />
      </View>
      <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
        {tr('track.noDriver', { date: dateLong(o.deliveryDate) })}
      </Text>
    </Card>
  );

  const summary = (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="secondary">
        {tr('track.orderCode', { code: o.code })}
      </Text>
      <Text variant="title2">
        {eta && step === 2 ? tr('track.etaBig', { time: timeShort(eta) }) : tr(STEPS[step]!.key)}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('track.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: 4,
          paddingBottom: insets.bottom + 32,
          gap: 16,
          width: '100%',
          maxWidth: t.layout.contentMax,
          alignSelf: 'center',
        }}
      >
        {summary}
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.6 }}>{map}</View>
            <View style={{ flex: 1, gap: 16 }}>
              {progress}
              {driverCard}
            </View>
          </View>
        ) : (
          <>
            {map}
            {driverCard}
            {progress}
          </>
        )}
        <Button
          label={tr('track.viewOrder')}
          variant="ghost"
          icon="receipt"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace({ pathname: '/order/[id]', params: { id: o.id } })
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  node: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: { width: 2, flex: 1, minHeight: 18 },
});
