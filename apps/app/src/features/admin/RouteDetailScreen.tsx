import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, qty, timeAgo, timeShort, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Avatar, Card, Pill, RadioRow } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField, TextField } from '../../ui/TextField';
import { type RouteDetail, useAdminMutations, useDrivers, useRoute } from './data';
import { AdminPage, Columns, DetailState, Facts, goUser, MutationError, Section, StatusPill } from './ui';

/** APP_SPEC screen 59 detail: route stops, assign a driver, start. */
export function RouteDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const route = useRoute(id);
  const r = route.data;
  const [assigning, setAssigning] = useState(false);
  return (
    <AdminPage
      title={r?.code ?? tr('admin.route.title')}
      back
      refreshing={route.isRefetching}
      onRefresh={() => route.refetch()}
    >
      {!r ? (
        <DetailState
          loading={route.isLoading}
          error={route.error}
          onRetry={() => route.refetch()}
          notFound={tr('admin.route.notFound')}
        />
      ) : (
        <>
          <Columns ratio={[1, 1.4]}>
            <View style={{ gap: 16 }}>
              <Summary route={r} onAssign={() => setAssigning(true)} />
            </View>
            <Stops route={r} />
          </Columns>
          <AssignSheet route={r} visible={assigning} onClose={() => setAssigning(false)} />
        </>
      )}
    </AdminPage>
  );
}

function Summary({ route: r, onAssign }: { route: RouteDetail; onAssign: () => void }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { startRoute } = useAdminMutations();
  const done = r.stops.filter((s) => s.status === 'COMPLETED').length;

  const start = async () => {
    const ok = await dialog.confirm({
      title: tr('admin.route.startConfirm', { code: r.code }),
      message: tr('admin.route.startBody', { driver: r.driver?.name ?? '' }),
      confirmLabel: tr('admin.route.start'),
      icon: 'truck',
    });
    if (!ok) return;
    try {
      await startRoute.mutateAsync({ routeId: r.id });
      toast.success(tr('admin.route.started', { code: r.code }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Section title={r.code} action={<StatusPill status={r.status} />}>
      <Facts
        rows={[
          { label: tr('admin.route.date'), value: dateLong(r.date) },
          { label: tr('admin.common.county'), value: r.county },
          { label: tr('admin.route.stopCount'), value: `${done} / ${r.stops.length}`, numeric: true },
          {
            label: tr('admin.route.distance'),
            value: r.distanceKm !== null ? `${r.distanceKm} km` : tr('admin.common.notSet'),
            numeric: true,
          },
          { label: tr('admin.route.vehicleLabel'), value: r.vehicle ?? tr('admin.common.notSet') },
          {
            label: tr('admin.route.startedAt'),
            value: r.startedAt ? timeShort(r.startedAt) : tr('admin.common.notSet'),
            numeric: true,
          },
        ]}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.route.driver')}</Text>
        {r.driver ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={r.driver.name} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{r.driver.name}</Text>
              <Text variant="caption" tone="secondary" numeric>
                {r.driver.phoneNumber ?? ''}
              </Text>
            </View>
            <Button
              label={tr('admin.common.view')}
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => goUser(r.driver!.id)}
            />
          </View>
        ) : (
          <Banner tone="warning" message={tr('admin.route.unassignedBody')} />
        )}
        {r.status === 'PLANNED' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label={r.driver ? tr('admin.route.changeDriver') : tr('admin.route.assign')}
              icon="user"
              size="sm"
              variant={r.driver ? 'secondary' : 'primary'}
              fullWidth={false}
              onPress={onAssign}
            />
            {r.driver && (
              <Button
                label={tr('admin.route.start')}
                icon="truck"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={start}
                loading={startRoute.isPending}
              />
            )}
          </View>
        )}
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="calloutStrong">{tr('admin.route.lastLocation')}</Text>
        {r.lastLocation ? (
          <Text variant="callout" numeric>
            {r.lastLocation.lat.toFixed(5)}, {r.lastLocation.lng.toFixed(5)} ·{' '}
            {timeAgo(r.lastLocation.recordedAt)}
            {r.lastLocation.speedKph !== null ? ` · ${Math.round(r.lastLocation.speedKph)} km/h` : ''}
          </Text>
        ) : (
          <Text variant="callout" tone="secondary">
            {tr('admin.route.noLocation')}
          </Text>
        )}
      </View>
      <MutationError error={startRoute.error} />
    </Section>
  );
}

function Stops({ route: r }: { route: RouteDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text variant="title3" accessibilityRole="header">
        {tr('admin.route.stops')}
      </Text>
      {r.stops.length === 0 && (
        <Text variant="callout" tone="secondary">
          {tr('admin.route.noStops')}
        </Text>
      )}
      {r.stops.map((s) => (
        <Card key={s.id} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: s.kind === 'PICKUP' ? t.colors.primaryTint : t.colors.infoTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                variant="calloutStrong"
                numeric
                style={{ color: s.kind === 'PICKUP' ? t.colors.primary : t.colors.info }}
              >
                {s.sequence}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pill
                  label={tr(`admin.status.${s.kind}`)}
                  tone={s.kind === 'PICKUP' ? 'brand' : 'info'}
                  size="sm"
                  icon={s.kind === 'PICKUP' ? 'farm' : 'building'}
                />
                <Text variant="bodyStrong" numeric numberOfLines={1}>
                  {s.order.code}
                </Text>
              </View>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {s.kind === 'PICKUP'
                  ? tr('admin.route.forBuyer', { buyer: s.order.buyerOrg.name })
                  : s.order.buyerOrg.name}
                {s.address ? ` · ${s.address}` : ''}
              </Text>
            </View>
            <StatusPill status={s.status} size="sm" />
          </View>
          <Text variant="callout" tone="secondary" numberOfLines={2}>
            {s.order.items
              .map(
                (it) =>
                  `${qty(it.quantity)} ${unitLabel(it.listing.produce.unit, it.quantity)} ${it.listing.produce.name}`,
              )
              .join(', ')}
          </Text>
          {(s.arrivedAt || s.completedAt || s.eta) && (
            <Text variant="caption" tone="tertiary" numeric>
              {s.eta ? `${tr('admin.route.eta')} ${timeShort(s.eta)}` : ''}
              {s.arrivedAt
                ? `${s.eta ? ' · ' : ''}${tr('admin.route.arrived')} ${timeShort(s.arrivedAt)}`
                : ''}
              {s.completedAt ? ` · ${tr('admin.route.completed')} ${timeShort(s.completedAt)}` : ''}
            </Text>
          )}
          {s.status === 'FAILED' && s.failureReason && (
            <Banner tone="danger" message={tr('admin.route.failedBecause', { reason: s.failureReason })} />
          )}
          {(s.cratesDropped > 0 || s.cratesCollected > 0) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="crate" size={14} color={t.colors.textSecondary} />
              <Text variant="caption" tone="secondary" numeric>
                {tr('admin.route.crates', { dropped: s.cratesDropped, collected: s.cratesCollected })}
              </Text>
            </View>
          )}
          {(s.podPhotoUrl || s.signatureUrl || s.recipientName) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {s.podPhotoUrl && (
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 8,
                    overflow: 'hidden',
                    backgroundColor: t.colors.surfaceMuted,
                  }}
                  accessibilityRole="image"
                  accessibilityLabel={tr('admin.route.pod')}
                >
                  <Image
                    source={{ uri: s.podPhotoUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                </View>
              )}
              {s.signatureUrl && (
                <View
                  style={{
                    width: 120,
                    height: 72,
                    borderRadius: 8,
                    overflow: 'hidden',
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: t.colors.line,
                  }}
                  accessibilityRole="image"
                  accessibilityLabel={tr('admin.route.signature')}
                >
                  <Image
                    source={{ uri: s.signatureUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                  />
                </View>
              )}
              {s.recipientName && (
                <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {tr('admin.route.recipient', { name: s.recipientName })}
                </Text>
              )}
            </View>
          )}
        </Card>
      ))}
    </View>
  );
}

function AssignSheet({
  route: r,
  visible,
  onClose,
}: {
  route: RouteDetail;
  visible: boolean;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { assignDriver } = useAdminMutations();
  const [q, setQ] = useState('');
  const drivers = useDrivers(q);
  const [driverId, setDriverId] = useState<string | null>(r.driverId);
  const [vehicle, setVehicle] = useState(r.vehicle ?? '');
  const list = drivers.data?.items ?? [];
  const chosen = list.find((d) => d.id === driverId);

  const submit = async () => {
    if (!driverId) return;
    const ok = await dialog.confirm({
      title: tr('admin.route.assignConfirm', { driver: chosen?.name ?? '', code: r.code }),
      message: tr('admin.route.assignBody', { date: dateLong(r.date) }),
      confirmLabel: tr('admin.route.assign'),
      icon: 'truck',
    });
    if (!ok) return;
    try {
      await assignDriver.mutateAsync({ routeId: r.id, driverId, vehicle: vehicle.trim() || undefined });
      toast.success(tr('admin.route.assigned', { driver: chosen?.name ?? '', code: r.code }));
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('admin.route.assignTitle')}
      subtitle={r.code}
      footer={
        <Button
          label={tr('admin.route.assign')}
          onPress={submit}
          disabled={!driverId}
          loading={assignDriver.isPending}
        />
      }
    >
      <SearchField value={q} onChangeText={setQ} placeholder={tr('admin.route.searchDrivers')} />
      {drivers.isLoading ? (
        <View style={{ gap: 8 }}>
          <Skeleton height={56} radius={10} />
          <Skeleton height={56} radius={10} />
        </View>
      ) : drivers.isError ? (
        <ErrorState compact message={humanError(drivers.error)} onRetry={() => drivers.refetch()} />
      ) : list.length === 0 ? (
        <Text variant="callout" tone="secondary">
          {tr('admin.route.noDrivers')}
        </Text>
      ) : (
        list.map((d) => (
          <RadioRow
            key={d.id}
            label={d.name}
            description={[d.phoneNumber, d.county].filter(Boolean).join(' · ')}
            selected={driverId === d.id}
            onPress={() => setDriverId(d.id)}
            disabled={!!d.banned}
          />
        ))
      )}
      <TextField
        label={tr('admin.route.vehicle')}
        placeholder={tr('admin.route.vehiclePlaceholder')}
        value={vehicle}
        onChangeText={setVehicle}
        autoCapitalize="characters"
        optional
      />
      <MutationError error={assignDriver.error} />
    </Sheet>
  );
}
