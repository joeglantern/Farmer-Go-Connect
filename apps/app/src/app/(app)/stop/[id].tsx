import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { CrateScanner } from '../../../features/driver/CrateScanner';
import {
  deliveryWindow,
  orderedStops,
  stopStatusView,
  useDriverAction,
  useRouteDetail,
  useStop,
} from '../../../features/driver/data';
import { LiveBadge } from '../../../features/driver/LiveBadge';
import { SignaturePad } from '../../../features/driver/SignaturePad';
import { useLocationSharing } from '../../../features/driver/useLocationSharing';
import { callPhone, openDirections } from '../../../features/qa/data';
import { PhotoStrip, type UploadedPhoto } from '../../../features/qa/PhotoStrip';
import { uploadBytes } from '../../../features/qa/upload';
import { ApiError } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { produceName, qty, timeShort, unitLabel } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button, IconButton } from '../../../ui/Button';
import { Card, Chip, Divider, Pill, Segmented } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { Sheet } from '../../../ui/overlays/Sheet';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { Skeleton, SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

const FAIL_REASONS = ['closed', 'unreachable', 'wrongAddress', 'refused', 'notReady', 'vehicle'] as const;

/** One stop: arrive, then complete with crates and proof of delivery, or record why it failed. */
export default function StopScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  // routeId is optional: older links pass it, but the stop itself says which route it is on.
  const { id, routeId: routeParam } = useLocalSearchParams<{ id: string; routeId?: string }>();
  const stopQ = useStop(id);
  const stop = stopQ.data;
  const routeId = stop?.route.id ?? routeParam;
  const routeStatus = stop?.route.status;
  // The route's other stops give "next stop" and the pickup-before-drop-off check.
  const route = useRouteDetail(routeId);
  const action = useDriverAction(routeId);
  const live = useLocationSharing(routeStatus === 'IN_PROGRESS' ? routeId : null);

  const [crates, setCrates] = useState<string[]>([]);
  const [returned, setReturned] = useState<string[]>([]);
  const [scanMode, setScanMode] = useState<'out' | 'back'>('out');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [recipient, setRecipient] = useState('');
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [saving, setSaving] = useState(false);
  const [podError, setPodError] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState<(typeof FAIL_REASONS)[number] | 'other' | null>(null);
  const [failText, setFailText] = useState('');

  const stops = route.data ? orderedStops(route.data) : [];
  const pickup = stop?.kind === 'PICKUP';
  const header = (
    <Header
      title={
        stop
          ? tr(pickup ? 'driver.pickupN' : 'driver.dropoffN', { n: stop.sequence })
          : tr('driver.stopTitle')
      }
      subtitle={stop ? `${stop.order.code} · ${stop.route.code}` : undefined}
    />
  );

  if (stopQ.isLoading) {
    return (
      <Screen header={header} maxWidth={720}>
        <View style={{ gap: 16 }}>
          <Skeleton height={160} radius={18} />
          <SkeletonList count={2} height={120} />
        </View>
      </Screen>
    );
  }
  if (stopQ.error && !(stopQ.error instanceof ApiError && stopQ.error.status === 404)) {
    return (
      <Screen header={header}>
        <ErrorState onRetry={() => void stopQ.refetch()} message={humanError(stopQ.error)} />
      </Screen>
    );
  }
  if (!stop || !routeId) {
    return (
      <Screen header={header}>
        <EmptyState
          art="noRoutes"
          title={tr('driver.stopGone')}
          action={{ label: tr('driver.backToRoute'), onPress: () => router.back(), icon: 'back' }}
        />
      </Screen>
    );
  }

  const title = pickup ? (stop.address ?? stop.order.code) : stop.order.buyerOrg.name;
  const open = stop.status === 'PENDING' || stop.status === 'ARRIVED';
  const arrived = stop.status === 'ARRIVED';
  const pickupStop = stops.find((s) => s.orderId === stop.orderId && s.kind === 'PICKUP');
  const pickupPending =
    !pickup && pickupStop && pickupStop.status !== 'COMPLETED' && pickupStop.status !== 'SKIPPED';
  const next = stops.find((s) => s.id !== stop.id && (s.status === 'PENDING' || s.status === 'ARRIVED'));
  const s = stopStatusView(stop.status);
  const win = deliveryWindow(stop.order.deliveryWindow);
  const buyerPhone = pickup ? null : stop.order.buyerOrg.phone;
  const wide = size !== 'compact';

  const addCode = (code: string) => {
    const [list, setList, other] =
      scanMode === 'out' || pickup ? [crates, setCrates, returned] : [returned, setReturned, crates];
    if (list.includes(code) || other.includes(code)) {
      toast.show(tr('driver.alreadyScanned', { code }));
      return;
    }
    setList([...list, code]);
  };

  const goNext = () => {
    if (next) router.replace({ pathname: '/stop/[id]', params: { id: next.id, routeId } });
    else router.back();
  };

  const arrive = () =>
    action.mutate(
      { kind: 'arrive', stopId: stop.id },
      {
        onSuccess: () => toast.success(tr('driver.arrivedToast')),
        onError: (e) => toast.error(humanError(e)),
      },
    );

  const complete = async () => {
    if (!pickup && photos.length === 0 && !signature) {
      setPodError(true);
      toast.error(tr('driver.podRequired'));
      return;
    }
    if (crates.length === 0) {
      const ok = await dialog.confirm({
        title: tr('driver.noCratesTitle'),
        message: tr(pickup ? 'driver.noCratesPickup' : 'driver.noCratesDropoff'),
        confirmLabel: tr('driver.continueAnyway'),
        cancelLabel: tr('driver.scanCrates'),
        icon: 'crate',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const signatureKey = signature
        ? await uploadBytes('proof-of-delivery', signature, 'image/png')
        : undefined;
      await action.mutateAsync({
        kind: 'complete',
        stopId: stop.id,
        body: {
          podPhotoKey: photos[0]?.key,
          signatureKey,
          recipientName: recipient.trim() || undefined,
          crateQrCodes: crates,
          cratesCollectedQrCodes: pickup ? [] : returned,
        },
      });
      toast.success(tr(pickup ? 'driver.pickedUp' : 'driver.delivered'));
      goNext();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  const fail = async () => {
    const reason =
      failReason === 'other' || !failReason
        ? failText.trim()
        : `${tr(`driver.fail.${failReason}`)}${failText.trim() ? `: ${failText.trim()}` : ''}`;
    if (reason.length < 3) return;
    const ok = await dialog.confirm({
      title: tr('driver.failConfirmTitle'),
      message: tr('driver.failConfirmBody'),
      confirmLabel: tr('driver.failConfirm'),
      destructive: true,
      icon: 'warning',
    });
    if (!ok) return;
    action.mutate(
      { kind: 'fail', stopId: stop.id, reason: reason.slice(0, 300) },
      {
        onSuccess: () => {
          setFailOpen(false);
          toast.show(tr('driver.failedToast'));
          goNext();
        },
        onError: (e) => toast.error(humanError(e)),
      },
    );
  };

  const footer = !open ? (
    <Button
      label={next ? tr('driver.nextStopN', { n: next.sequence }) : tr('driver.backToRoute')}
      iconRight="forward"
      size="lg"
      onPress={goNext}
    />
  ) : routeStatus === 'PLANNED' ? (
    <Button label={tr('driver.backToRoute')} variant="secondary" size="lg" onPress={() => router.back()} />
  ) : !arrived ? (
    <View style={styles.footerRow}>
      <Button
        label={tr('driver.navigate')}
        variant="secondary"
        icon="navigate"
        size="lg"
        style={{ flex: 1 }}
        onPress={() => openDirections(stop.lat, stop.lng, title)}
      />
      <Button
        label={tr('driver.imHere')}
        icon="location"
        size="lg"
        style={{ flex: 1.2 }}
        loading={action.isPending}
        onPress={arrive}
      />
    </View>
  ) : (
    <Button
      label={tr(pickup ? 'driver.confirmPickup' : 'driver.confirmDelivery')}
      icon="checkCircle"
      size="lg"
      loading={saving}
      disabled={!!pickupPending}
      onPress={() => void complete()}
    />
  );

  const summary = (
    <View style={[styles.hero, { backgroundColor: t.colors.band, borderRadius: t.radius.lg }]}>
      <View style={styles.heroHead}>
        <View style={[styles.kindIcon, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
          <Icon name={pickup ? 'farm' : 'building'} size={26} color={t.colors.accentLime} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="micro" tone="onBrandMuted">
            {tr(pickup ? 'driver.pickup' : 'driver.dropoff').toUpperCase()}
            {stop.eta ? `  ·  ${tr('driver.eta')} ${timeShort(stop.eta)}` : ''}
          </Text>
          <Text variant="title2" tone="onBrand" numberOfLines={2}>
            {title}
          </Text>
        </View>
        <IconButton
          icon="navigate"
          label={tr('driver.navigate')}
          variant="onBrand"
          onPress={() => openDirections(stop.lat, stop.lng, title)}
        />
      </View>
      {!pickup && stop.address && (
        <Text variant="callout" tone="onBrandMuted">
          {stop.address}
        </Text>
      )}
      {(win || buyerPhone) && (
        <View style={styles.contactRow}>
          {win && (
            <View
              style={[
                styles.window,
                { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: t.radius.pill },
              ]}
            >
              <Icon name="clock" size={16} color={t.colors.accentLime} />
              <Text variant="calloutStrong" tone="onBrand" numeric>
                {tr('driver.window', win)}
              </Text>
            </View>
          )}
          {buyerPhone && (
            <Button
              label={tr('driver.callBuyer')}
              variant="onBrand"
              icon="phone"
              size="sm"
              fullWidth={false}
              onPress={() => callPhone(buyerPhone)}
            />
          )}
        </View>
      )}
      <View style={{ gap: 6 }}>
        {stop.order.items.map((it) => (
          <View key={`${it.listing.produce.name}:${it.quantity}`} style={styles.loadRow}>
            <Text variant="body" tone="onBrand" style={{ flex: 1 }} numberOfLines={1}>
              {produceName(it.listing.produce)}
            </Text>
            <Text variant="title3" tone="onBrand" numeric>
              {qty(it.quantity)} {unitLabel(it.listing.produce.unit, it.quantity)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.statusRow}>
        <Pill label={tr(s.labelKey)} tone={s.tone} icon={s.icon} size="sm" />
        {/* The banner with Retry sits further down; the header still says sharing is off. */}
        <LiveBadge state={live.state} pill />
      </View>
    </View>
  );

  const crateList = (codes: string[], remove: (c: string) => void) =>
    codes.length > 0 && (
      <View style={styles.codes}>
        {codes.map((c) => (
          <View
            key={c}
            style={[styles.code, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.pill }]}
          >
            <Icon name="crate" size={14} color={t.colors.primary} />
            <Text variant="caption" tone="brand" numeric>
              {c}
            </Text>
            <IconButton
              icon="close"
              label={tr('driver.removeCode', { code: c })}
              size={24}
              iconSize={12}
              onPress={() => remove(c)}
            />
          </View>
        ))}
      </View>
    );

  return (
    <Screen
      header={header}
      footer={footer}
      maxWidth={wide ? 1080 : undefined}
      refreshing={stopQ.isRefetching}
      onRefresh={() => {
        void stopQ.refetch();
        void route.refetch();
      }}
    >
      <View style={[{ gap: 20 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={[{ gap: 16 }, wide && { width: 400 }]}>
          {summary}
          {route.error ? (
            // Without the route, "next stop" and the pickup-first check can't be trusted: say so.
            <Banner
              tone="warning"
              message={humanError(route.error)}
              action={{ label: tr('common.retry'), onPress: () => void route.refetch() }}
            />
          ) : null}
          {(live.state === 'denied' || live.state === 'error') && <LiveBadge state={live.state} />}
          {routeStatus === 'PLANNED' && open && <Banner tone="warning" message={tr('driver.startFirst')} />}
          {pickupPending && (
            <Banner
              tone="warning"
              title={tr('driver.pickupFirstTitle')}
              message={tr('driver.pickupFirstBody', { n: pickupStop?.sequence ?? '' })}
            />
          )}
          {stop.status === 'COMPLETED' && (
            <Banner tone="success" message={tr(pickup ? 'driver.pickedUp' : 'driver.delivered')} />
          )}
          {stop.status === 'FAILED' && <Banner tone="danger" message={tr('driver.stopFailed')} />}
        </View>

        {open && routeStatus === 'IN_PROGRESS' && (
          <View style={{ flex: 1, gap: 16 }}>
            {!arrived && (
              <Card style={{ gap: 8, alignItems: 'center', paddingVertical: 28 }}>
                <Icon name="location" size={32} color={t.colors.primary} weight="duotone" />
                <Text variant="headline" align="center">
                  {tr('driver.onTheWay')}
                </Text>
                <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 360 }}>
                  {tr('driver.tapHere')}
                </Text>
              </Card>
            )}

            {arrived && (
              <>
                <Card style={{ gap: 14 }}>
                  <View style={styles.sectionHead}>
                    <Text variant="headline" style={{ flex: 1 }}>
                      {tr('driver.crates')}
                    </Text>
                    <Text variant="title2" numeric tone="brand">
                      {crates.length + returned.length}
                    </Text>
                  </View>
                  {!pickup && (
                    <Segmented
                      value={scanMode}
                      onChange={setScanMode}
                      options={[
                        { value: 'out', label: tr('driver.cratesDelivered'), count: crates.length },
                        { value: 'back', label: tr('driver.cratesCollected'), count: returned.length },
                      ]}
                    />
                  )}
                  <Text variant="caption" tone="secondary">
                    {tr(
                      pickup
                        ? 'driver.scanLoadHint'
                        : scanMode === 'out'
                          ? 'driver.scanDeliverHint'
                          : 'driver.scanReturnHint',
                    )}
                  </Text>
                  <CrateScanner onCode={addCode} />
                  {crateList(crates, (c) => setCrates(crates.filter((x) => x !== c)))}
                  {!pickup && returned.length > 0 && (
                    <>
                      <Divider />
                      <Text variant="calloutStrong">{tr('driver.cratesCollected')}</Text>
                      {crateList(returned, (c) => setReturned(returned.filter((x) => x !== c)))}
                    </>
                  )}
                </Card>

                {!pickup && (
                  <Card
                    style={{
                      gap: 16,
                      borderWidth: podError && !photos.length && !signature ? 1.5 : 0,
                      borderColor: t.colors.danger,
                    }}
                  >
                    <View style={{ gap: 4 }}>
                      <Text variant="headline">{tr('driver.proof')}</Text>
                      <Text
                        variant="caption"
                        tone={podError && !photos.length && !signature ? 'danger' : 'secondary'}
                      >
                        {tr('driver.proofHint')}
                      </Text>
                    </View>
                    <PhotoStrip
                      bucket="proof-of-delivery"
                      photos={photos}
                      onChange={setPhotos}
                      max={1}
                      size={96}
                    />
                    <TextField
                      label={tr('driver.recipient')}
                      optional
                      placeholder={tr('driver.recipientHint')}
                      value={recipient}
                      onChangeText={setRecipient}
                      autoCapitalize="words"
                      maxLength={120}
                    />
                    <View style={{ gap: 6 }}>
                      <Text variant="calloutStrong">{tr('driver.signature')}</Text>
                      <SignaturePad onChange={setSignature} />
                    </View>
                  </Card>
                )}
              </>
            )}

            <Button
              label={tr('driver.cantComplete')}
              variant="ghost"
              icon="warning"
              onPress={() => setFailOpen(true)}
            />
          </View>
        )}
      </View>

      <Sheet
        visible={failOpen}
        onClose={() => setFailOpen(false)}
        title={tr('driver.failTitle')}
        subtitle={tr('driver.failSubtitle')}
        footer={
          <Button
            label={tr('driver.failConfirm')}
            variant="danger"
            loading={action.isPending}
            disabled={failReason === null || (failReason === 'other' && failText.trim().length < 3)}
            onPress={() => void fail()}
          />
        }
      >
        <View style={styles.chips}>
          {[...FAIL_REASONS, 'other' as const].map((k) => (
            <Chip
              key={k}
              label={tr(`driver.fail.${k}`)}
              selected={failReason === k}
              onPress={() => setFailReason(k)}
            />
          ))}
        </View>
        <TextField
          label={failReason === 'other' ? tr('driver.failWhat') : tr('driver.failMore')}
          optional={failReason !== 'other'}
          value={failText}
          onChangeText={setFailText}
          multiline
          maxLength={250}
          containerStyle={{ marginTop: 16 }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', gap: 10 },
  hero: { padding: 20, gap: 14 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  loadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  window: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6 },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 2, height: 36 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
