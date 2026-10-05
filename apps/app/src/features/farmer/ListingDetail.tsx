import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { dateLong, kes, parseKes, produceName, qty, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Divider, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Header } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { listingStatusView } from './components';
import {
  addDays,
  isLiveListing,
  isoDay,
  useHarvestReady,
  useLatestPrices,
  useMyListing,
  useUpdateListing,
} from './data';

/** One of my listings: stock, price, window, and the actions a farmer needs. */
export function ListingDetail({ id, embedded }: { id: string; embedded?: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const toast = useToast();
  const q = useMyListing(id);
  const update = useUpdateListing(id);
  const harvest = useHarvestReady(id);
  const l = q.data;
  const prices = useLatestPrices(l?.farm.county, l?.produceId, !!l);
  const market = l ? prices.data?.find((p) => p.produceId === l.produceId) : undefined;
  const [editOpen, setEditOpen] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, padding: 20, gap: 14 }}>
        {!embedded && <Header />}
        <Skeleton height={180} radius={16} />
        <Skeleton height={120} radius={14} />
      </View>
    );
  }
  if (q.error || !l) {
    return (
      <View style={{ flex: 1 }}>
        {!embedded && <Header />}
        <ErrorState onRetry={() => q.refetch()} message={q.error ? humanError(q.error) : undefined} />
      </View>
    );
  }

  const s = listingStatusView(l);
  const name = produceName(l.produce);
  const unit = l.produce.unit;
  const left = Number(l.quantityLeft);
  const total = Number(l.quantity);
  const sold = Math.max(0, total - left);
  const live = isLiveListing(l);
  const paused = l.status === 'DRAFT';
  const closed = l.status === 'CANCELLED' || !live;
  // An expired window can be reopened with a new end date (B25); a cancelled listing cannot.
  const expired = closed && l.status !== 'CANCELLED';

  const setStatus = async (status: 'OPEN' | 'DRAFT' | 'CANCELLED') => {
    const copy = {
      OPEN: {
        title: tr('listings.resumeTitle'),
        message: tr('listings.resumeBody'),
        confirmLabel: tr('listings.resume'),
        done: tr('listings.resumed'),
      },
      DRAFT: {
        title: tr('listings.pauseTitle'),
        message: tr('listings.pauseBody'),
        confirmLabel: tr('listings.pause'),
        done: tr('listings.paused'),
      },
      CANCELLED: {
        title: tr('listings.closeTitle'),
        message: tr('listings.closeBody'),
        confirmLabel: tr('listings.close'),
        done: tr('listings.closed'),
      },
    }[status];
    const ok = await dialog.confirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      destructive: status === 'CANCELLED',
    });
    if (!ok) return;
    try {
      await update.mutateAsync({ status });
      toast.success(copy.done);
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const markHarvested = async () => {
    const ok = await dialog.confirm({
      title: tr('listings.harvestTitle'),
      message: tr('listings.harvestBody'),
      confirmLabel: tr('listings.harvestConfirm'),
      icon: 'basket',
    });
    if (!ok) return;
    try {
      const res = await harvest.mutateAsync();
      toast.success(
        res.ordersReady
          ? tr('listings.harvestDoneOrders', { count: res.ordersReady })
          : tr('listings.harvestDone'),
      );
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const undoHarvest = async () => {
    const ok = await dialog.confirm({
      title: tr('listings.undoHarvestTitle'),
      message: tr('listings.undoHarvestBody'),
      confirmLabel: tr('listings.undoHarvest'),
    });
    if (!ok) return;
    try {
      await harvest.mutateAsync(true);
      toast.success(tr('listings.undoHarvestDone'));
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'HARVEST_ALREADY_IN_QA'
          ? tr('listings.undoHarvestInQa')
          : humanError(err),
      );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {!embedded && <Header title={name} subtitle={l.farm.name} />}
      <ScrollView
        contentContainerStyle={{
          padding: embedded ? 24 : 20,
          paddingTop: embedded ? 20 : 4,
          paddingBottom: insets.bottom + 40,
          gap: 16,
          maxWidth: 760,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <ProduceImage
              uri={l.photoUrls[0] ?? l.produce.imageUrl}
              produce={l.produce}
              category={l.produce.category}
              size={88}
              radius={14}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="title2">{name}</Text>
              <Text variant="priceLarge" tone="brand" numeric>
                {kes(l.pricePerUnit)}
                <Text variant="callout" tone="secondary">
                  {' '}
                  {tr('common.perUnit', { unit: unitLabel(unit) })}
                </Text>
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
                {l.grade && <Pill label={tr('farmer.gradeShort', { grade: l.grade })} size="sm" />}
                {l.harvestReady && (
                  <Pill label={tr('listings.harvested')} tone="success" icon="check" size="sm" />
                )}
              </View>
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="callout" tone="secondary">
                {tr('listings.soldOf', { sold: qty(sold), total: qty(total), unit: unitLabel(unit, total) })}
              </Text>
              <Text variant="calloutStrong" tone="leaf" numeric>
                {tr('farmer.available', { qty: qty(left), unit: unitLabel(unit, left) })}
              </Text>
            </View>
            <View style={[styles.bar, { backgroundColor: t.colors.line }]}>
              <View
                style={{
                  width: `${total ? Math.min(100, (sold / total) * 100) : 0}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: t.colors.primary,
                }}
              />
            </View>
          </View>
        </Card>

        {paused && <Banner tone="warning" message={tr('listings.pausedNote')} />}
        {closed && !paused && (
          <Banner tone="info" message={expired ? tr('listings.expiredNote') : tr('listings.closedNote')} />
        )}

        {!closed && (
          <View style={styles.actions}>
            {!l.harvestReady && sold > 0 && (
              <Button
                label={tr('listings.harvestConfirm')}
                icon="basket"
                onPress={markHarvested}
                loading={harvest.isPending}
              />
            )}
            <Button
              label={tr('listings.edit')}
              icon="edit"
              variant={sold > 0 && !l.harvestReady ? 'outline' : 'primary'}
              onPress={() => setEditOpen(true)}
            />
            {paused ? (
              <Button
                label={tr('listings.resume')}
                icon="refresh"
                variant="outline"
                size="md"
                fullWidth={false}
                onPress={() => setStatus('OPEN')}
              />
            ) : (
              <Button
                label={tr('listings.pause')}
                icon="clock"
                variant="outline"
                size="md"
                fullWidth={false}
                onPress={() => setStatus('DRAFT')}
              />
            )}
            <Button
              label={tr('listings.close')}
              icon="close"
              variant="ghost"
              size="md"
              fullWidth={false}
              onPress={() => setStatus('CANCELLED')}
            />
            {l.harvestReady && (
              <Button
                label={tr('listings.undoHarvest')}
                icon="refresh"
                variant="ghost"
                size="md"
                fullWidth={false}
                onPress={undoHarvest}
                loading={harvest.isPending}
              />
            )}
          </View>
        )}
        {expired && (
          <Button label={tr('listings.reactivate')} icon="refresh" onPress={() => setReactivating(true)} />
        )}
        {closed && (
          <Button
            label={tr('listings.relist')}
            variant={expired ? 'outline' : 'primary'}
            icon="repeat"
            onPress={() =>
              router.push({
                pathname: '/sell',
                params: { produceId: l.produceId, farmId: l.farmId, price: String(l.pricePerUnit) },
              })
            }
          />
        )}

        <Card style={{ gap: 10 }}>
          <Text variant="headline" accessibilityRole="header">
            {tr('listings.details')}
          </Text>
          <KV label={tr('sell.step.farm')} value={`${l.farm.name}, ${l.farm.county}`} />
          <KV label={tr('sell.readyFrom')} value={dateLong(l.availableFrom)} />
          <KV label={tr('sell.availableUntil')} value={dateLong(l.availableTo)} />
          <KV label={tr('listings.listedQty')} value={`${qty(total)} ${unitLabel(unit, total)}`} />
          {l.notes && <KV label={tr('sell.notes')} value={l.notes} />}
        </Card>

        {market && (
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="chart" size={20} color={t.colors.primary} />
              <Text variant="headline" style={{ flex: 1 }}>
                {tr('sell.marketThisWeek', { county: market.county })}
              </Text>
              {market.changePct != null && (
                <Pill
                  label={`${market.changePct > 0 ? '+' : ''}${market.changePct}%`}
                  tone={market.changePct >= 0 ? 'success' : 'warning'}
                  icon={market.changePct >= 0 ? 'trendUp' : 'trendDown'}
                  size="sm"
                />
              )}
            </View>
            <Text variant="callout" tone="secondary" numeric>
              {tr('sell.marketRange', {
                avg: kes(market.avgPrice),
                min: kes(market.minPrice),
                max: kes(market.maxPrice),
              })}
            </Text>
            <Divider />
            <Text variant="caption" tone="tertiary">
              {l.pricePerUnit > market.maxPrice
                ? tr('listings.aboveMarket')
                : l.pricePerUnit < market.minPrice
                  ? tr('listings.belowMarket')
                  : tr('listings.inMarket')}
            </Text>
          </Card>
        )}
      </ScrollView>
      <EditSheet
        visible={editOpen || reactivating}
        reactivate={reactivating}
        onClose={() => {
          setEditOpen(false);
          setReactivating(false);
        }}
        initial={{
          quantity: String(total),
          price: String(l.pricePerUnit / 100),
          to: l.availableTo.slice(0, 10),
        }}
        sold={sold}
        unit={unit}
        saving={update.isPending}
        onSave={async (v) => {
          try {
            await update.mutateAsync(v);
            toast.success(reactivating ? tr('listings.reactivated') : tr('listings.savedToast'));
            setEditOpen(false);
            setReactivating(false);
          } catch (err) {
            toast.error(humanError(err));
          }
        }}
      />
    </View>
  );
}

function EditSheet({
  visible,
  reactivate,
  onClose,
  initial,
  sold,
  unit,
  saving,
  onSave,
}: {
  visible: boolean;
  /** Reopen an expired listing: the new end date must be today or later. */
  reactivate?: boolean;
  onClose: () => void;
  initial: { quantity: string; price: string; to: string };
  sold: number;
  unit: string;
  saving: boolean;
  onSave: (v: { quantity: number; pricePerUnit: number; availableTo: string }) => void;
}) {
  const { t: tr } = useTranslation();
  const [quantity, setQuantity] = useState(initial.quantity);
  const [price, setPrice] = useState(initial.price);
  const [to, setTo] = useState(initial.to);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (visible) {
      setQuantity(initial.quantity);
      setPrice(initial.price);
      setTo(reactivate ? isoDay(addDays(new Date(), 7)) : initial.to);
      setErrors({});
    }
  }, [visible, reactivate, initial.quantity, initial.price, initial.to]);

  const submit = () => {
    const e: Record<string, string> = {};
    const qn = Number(quantity.replace(',', '.'));
    const pc = parseKes(price);
    if (!Number.isFinite(qn) || qn < 0.01) e.quantity = tr('sell.qtyInvalid');
    else if (qn < sold)
      e.quantity = tr('listings.belowSold', { sold: qty(sold), unit: unitLabel(unit, sold) });
    if (!pc) e.price = tr('sell.priceInvalid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(new Date(to).getTime()))
      e.to = tr('listings.dateInvalid');
    else if (reactivate && new Date(`${to}T23:59:59`).getTime() < Date.now())
      e.to = tr('listings.dateInPast');
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ quantity: Math.round(qn * 100) / 100, pricePerUnit: pc!, availableTo: to });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={reactivate ? tr('listings.reactivate') : tr('listings.edit')}
      subtitle={reactivate ? tr('listings.reactivateBody') : undefined}
      footer={<Button label={tr('common.saveChanges')} onPress={submit} loading={saving} />}
    >
      <TextField
        label={tr('listings.totalQty', { unit: unitLabel(unit, 2) })}
        value={quantity}
        onChangeText={(v) => setQuantity(v.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        error={errors.quantity}
        hint={
          sold > 0 ? tr('listings.soldHint', { sold: qty(sold), unit: unitLabel(unit, sold) }) : undefined
        }
      />
      <TextField
        label={tr('sell.pricePer', { unit: unitLabel(unit) })}
        prefix="KES"
        value={price}
        onChangeText={(v) => setPrice(v.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        error={errors.price}
      />
      <TextField
        label={tr('sell.availableUntil')}
        value={to}
        onChangeText={setTo}
        placeholder="2026-10-15"
        error={errors.to}
        hint={tr('listings.dateHint')}
        maxLength={10}
      />
    </Sheet>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text variant="callout" tone="secondary">
        {label}
      </Text>
      <Text variant="callout" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
