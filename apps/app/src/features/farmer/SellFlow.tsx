import type { FarmDto, ProduceDto } from '@farmgo/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProduce } from '../../data/catalog';
import { useSession } from '../../data/session';
import { humanError } from '../../lib/errors';
import {
  dateLong,
  dateShort,
  kes,
  parseKes,
  produceName,
  qty,
  relativeDay,
  unitLabel,
} from '../../lib/format';
import { useRole, useShowsTabBar } from '../../nav/Shell';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Chip, Divider, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField, TextField } from '../../ui/TextField';
import { PhotoStrip, type UploadedPhoto } from '../qa/PhotoStrip';
import { StepBar } from './components';
import { addDays, isoDay, useCreateListing, useFarm, useFarms, useLatestPrices } from './data';
import { FarmSheet } from './FarmSheet';

const STEPS = ['farm', 'produce', 'amount', 'when', 'photos', 'review'] as const;
type Step = (typeof STEPS)[number];
const CATEGORIES = [
  'VEGETABLE',
  'FRUIT',
  'HERB',
  'GRAIN',
  'LEGUME',
  'TUBER',
  'DAIRY',
  'POULTRY',
  'OTHER',
] as const;

/**
 * Sell tab: list produce in six short steps. Accepts `farmId` (field agents listing for a farmer),
 * `produceId`, `quantity` and `price` (from the demand board) to prefill.
 */
export function SellFlow() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const role = useRole();
  const tabBar = useShowsTabBar();
  const params = useLocalSearchParams<{
    farmId?: string;
    farmerId?: string;
    produceId?: string;
    quantity?: string;
    price?: string;
  }>();
  const me = useSession((s) => s.me);
  const agentMode = role === 'agent' || ((!!params.farmId || !!params.farmerId) && role !== 'farmer');
  // Agents: the farmer comes from ?farmerId=, or from the farm they opened Sell on.
  const paramFarm = useFarm(agentMode && !params.farmerId ? params.farmId : undefined);
  const agentFarmerId = params.farmerId ?? paramFarm.data?.farmerId;
  const farms = useFarms(!agentMode || !!agentFarmerId, agentMode ? agentFarmerId : undefined);
  const produce = useProduce();
  const create = useCreateListing();

  const [step, setStep] = useState<Step>('farm');
  const [farmId, setFarmId] = useState<string | null>(params.farmId ?? null);
  const [produceId, setProduceId] = useState<string | null>(params.produceId ?? null);
  const [quantity, setQuantity] = useState(params.quantity ?? '');
  const [price, setPrice] = useState(params.price ? String(Number(params.price) / 100) : '');
  const [grade, setGrade] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDay(addDays(today, 1)));
  const [to, setTo] = useState(isoDay(addDays(today, 7)));
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [farmSheet, setFarmSheet] = useState(false);
  const [done, setDone] = useState<{ id: string; draft: boolean } | null>(null);

  const farmList = useMemo<FarmDto[]>(
    () => (farms.data ?? (agentMode && paramFarm.data ? [paramFarm.data] : [])).filter((f) => f.active),
    [agentMode, paramFarm.data, farms.data],
  );
  const farm = farmList.find((f) => f.id === farmId) ?? null;
  const item = produce.data?.find((p) => p.id === produceId) ?? null;
  const prices = useLatestPrices(farm?.county, item?.id, !!item);
  const market = item ? prices.data?.find((p) => p.produceId === item.id) : undefined;

  // Preselect the only farm and start at the produce step.
  useEffect(() => {
    if (!farmId && farmList.length === 1) setFarmId(farmList[0]!.id);
  }, [farmId, farmList]);
  // Skip the farm step once the only (or given) farm resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the farm resolves, not on every step change
  useEffect(() => {
    if (step === 'farm' && farm && (farmList.length === 1 || params.farmId))
      setStep(produceId ? 'amount' : 'produce');
  }, [farm?.id]);

  // Sell is a tab that stays mounted, so values passed from the demand board, a listing, a farm or
  // an agent's farmer page must be applied each time they change, and a finished listing must not
  // greet the next visit.
  const paramKey = [params.farmId, params.farmerId, params.produceId, params.quantity, params.price].join(
    '|',
  );
  const seenParams = useRef(paramKey);
  const doneRef = useRef(done);
  doneRef.current = done;
  useFocusEffect(
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs only when the passed values change; the rest is read from this render
    useCallback(() => {
      const changed = seenParams.current !== paramKey;
      seenParams.current = paramKey;
      if (!changed && !doneRef.current) return;
      const fid = params.farmId ?? (farmList.length === 1 ? farmList[0]!.id : null);
      setFarmId(fid);
      setProduceId(params.produceId ?? null);
      setQuantity(params.quantity ?? '');
      setPrice(params.price ? String(Number(params.price) / 100) : '');
      setGrade(null);
      setPhotos([]);
      setNotes('');
      setErrors({});
      setDone(null);
      setStep(fid && fid === farm?.id ? (params.produceId ? 'amount' : 'produce') : 'farm');
    }, [paramKey]),
  );

  const index = STEPS.indexOf(step);
  const dirty = !!produceId || !!quantity || !!price || photos.length > 0 || !!notes;
  const priceCents = parseKes(price);
  const qtyNum = Number(quantity.replace(',', '.'));

  const validate = (s: Step): boolean => {
    const e: Record<string, string> = {};
    if (s === 'farm' && !farm) e.farm = tr('sell.pickFarm');
    if (s === 'produce' && !item) e.produce = tr('sell.pickProduce');
    if (s === 'amount') {
      if (!Number.isFinite(qtyNum) || qtyNum < 0.01) e.quantity = tr('sell.qtyInvalid');
      else if (Math.round(qtyNum * 100) !== qtyNum * 100) e.quantity = tr('sell.qtyDecimals');
      if (!priceCents) e.price = tr('sell.priceInvalid');
    }
    if (s === 'when' && to < from) e.to = tr('sell.toBeforeFrom');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]!);
  };
  const back = async () => {
    if (index > 0 && !(index === 1 && (farmList.length === 1 || params.farmId)))
      return setStep(STEPS[index - 1]!);
    await leave();
  };
  const leave = async () => {
    if (dirty && !done) {
      const ok = await dialog.confirm({
        title: tr('sell.discardTitle'),
        message: tr('sell.discardBody'),
        confirmLabel: tr('sell.discard'),
        destructive: true,
      });
      if (!ok) return;
    }
    reset();
    if (router.canGoBack()) router.back();
    else router.navigate('/home');
  };
  const reset = () => {
    setStep('farm');
    setProduceId(null);
    setQuantity('');
    setPrice('');
    setGrade(null);
    setPhotos([]);
    setNotes('');
    setErrors({});
    setDone(null);
    if (!params.farmId && farmList.length !== 1) setFarmId(null);
  };

  const submit = async (draft: boolean) => {
    if (!farm) {
      setStep('farm');
      return;
    }
    if (!item || !priceCents) return;
    try {
      const l = await create.mutateAsync({
        farmId: farm.id,
        produceId: item.id,
        quantity: Math.round(qtyNum * 100) / 100,
        grade: grade ?? undefined,
        pricePerUnit: priceCents,
        availableFrom: from,
        availableTo: to,
        photos: photos.map((p) => p.key),
        notes: notes.trim() || undefined,
        status: draft ? 'DRAFT' : 'OPEN',
      });
      setDone({ id: l.id, draft });
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const title = agentMode && farm ? tr('sell.titleFor', { farm: farm.name }) : tr('sell.title');
  const wide = size !== 'compact';

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header title={title} back={false} />
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}
        >
          <EmptyState
            art="orderPlaced"
            title={done.draft ? tr('sell.draftDoneTitle') : tr('sell.doneTitle')}
            body={tr(done.draft ? 'sell.draftDoneBody' : 'sell.doneBody', {
              name: item ? produceName(item) : '',
            })}
          />
          <Button
            label={tr('sell.viewListing')}
            icon="basket"
            onPress={() => router.replace({ pathname: '/listings/[id]', params: { id: done.id } })}
          />
          <Button label={tr('sell.listAnother')} variant="outline" icon="plus" onPress={reset} />
          <Button
            label={tr('nav.buyersNeed')}
            variant="ghost"
            icon="megaphone"
            onPress={() => router.push('/demand-board')}
          />
        </ScrollView>
      </View>
    );
  }

  const loadingFarms = paramFarm.isLoading || farms.isLoading;
  const farmsError = paramFarm.error ?? farms.error;

  const body = (() => {
    switch (step) {
      case 'farm':
        if (loadingFarms)
          return (
            <View style={{ gap: 10 }}>
              <Skeleton height={76} radius={14} />
              <Skeleton height={76} radius={14} />
            </View>
          );
        if (farmsError)
          return (
            <ErrorState
              onRetry={() => {
                void paramFarm.refetch();
                void farms.refetch();
              }}
              message={humanError(farmsError)}
            />
          );
        return (
          <View style={{ gap: 10 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('sell.whichFarm')}
            </Text>
            {farmList.length === 0 && (
              <Card style={{ gap: 10, alignItems: 'center', paddingVertical: 24 }}>
                <Icon name="farm" size={32} color={t.colors.leaf} weight="duotone" />
                <Text variant="headline" align="center">
                  {tr('sell.noFarmTitle')}
                </Text>
                <Text variant="callout" tone="secondary" align="center">
                  {tr('sell.noFarmBody')}
                </Text>
              </Card>
            )}
            {farmList.map((f) => {
              const selected = f.id === farmId;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    setFarmId(f.id);
                    setErrors({});
                  }}
                  haptics="selection"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${f.name}, ${f.county}`}
                  focusRadius={t.radius.md}
                  style={[
                    styles.option,
                    {
                      borderRadius: t.radius.md,
                      borderColor: selected ? t.colors.primary : t.colors.line,
                      backgroundColor: selected ? t.colors.primaryTint : t.colors.surface,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.round,
                      { backgroundColor: selected ? t.colors.primary : t.colors.primaryTint },
                    ]}
                  >
                    <Icon name="farm" size={22} color={selected ? '#FFFFFF' : t.colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{f.name}</Text>
                    <Text variant="caption" tone="secondary">
                      {[f.ward, f.county].filter(Boolean).join(', ')}
                      {f.acreage ? ` · ${tr('farms.acres', { n: qty(f.acreage) })}` : ''}
                    </Text>
                  </View>
                  {f.isOrganic && <Pill label={tr('farms.organic')} tone="success" size="sm" />}
                  <Icon
                    name={selected ? 'checkCircle' : 'dot'}
                    size={22}
                    color={selected ? t.colors.primary : t.colors.lineStrong}
                    weight={selected ? 'fill' : 'regular'}
                  />
                </Pressable>
              );
            })}
            {!agentMode && (
              <Button
                label={tr('farms.add')}
                icon="plus"
                variant="outline"
                onPress={() => setFarmSheet(true)}
              />
            )}
            {errors.farm && (
              <Text variant="caption" tone="danger" accessibilityRole="alert">
                {errors.farm}
              </Text>
            )}
          </View>
        );
      case 'produce':
        return (
          <ProduceStep
            list={produce.data}
            loading={produce.isLoading}
            error={produce.error}
            retry={() => produce.refetch()}
            value={produceId}
            onChange={(id) => {
              setProduceId(id);
              setGrade(null);
              setErrors({});
            }}
            errorText={errors.produce}
          />
        );
      case 'amount':
        return (
          <View style={{ gap: 16 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('sell.howMuch')}
            </Text>
            <TextField
              label={tr('sell.quantity')}
              value={quantity}
              onChangeText={(v) => {
                setQuantity(v.replace(/[^\d.,]/g, ''));
                setErrors((e) => ({ ...e, quantity: '' }));
              }}
              keyboardType="decimal-pad"
              placeholder="50"
              suffix={
                item ? (
                  <Text variant="callout" tone="secondary">
                    {unitLabel(item.unit, 2)}
                  </Text>
                ) : undefined
              }
              error={errors.quantity || undefined}
              hint={tr('sell.quantityHint')}
            />
            <TextField
              label={item ? tr('sell.pricePer', { unit: unitLabel(item.unit) }) : tr('sell.price')}
              value={price}
              onChangeText={(v) => {
                setPrice(v.replace(/[^\d.,]/g, ''));
                setErrors((e) => ({ ...e, price: '' }));
              }}
              keyboardType="decimal-pad"
              prefix="KES"
              placeholder={market ? String(Math.round(market.avgPrice / 100)) : '100'}
              error={errors.price || undefined}
            />
            {market ? (
              <Pressable
                onPress={() => setPrice(String(Math.round(market.avgPrice / 100)))}
                accessibilityRole="button"
                accessibilityLabel={tr('sell.useMarket', { price: kes(market.avgPrice) })}
                focusRadius={t.radius.md}
                style={({ pressed }) => [
                  styles.hint,
                  {
                    backgroundColor: pressed ? t.colors.primaryTintStrong : t.colors.primaryTint,
                    borderRadius: t.radius.md,
                  },
                ]}
              >
                <Icon name="chart" size={22} color={t.colors.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="calloutStrong">{tr('sell.marketThisWeek', { county: market.county })}</Text>
                  <Text variant="caption" tone="secondary" numeric>
                    {tr('sell.marketRange', {
                      avg: kes(market.avgPrice),
                      min: kes(market.minPrice),
                      max: kes(market.maxPrice),
                    })}
                  </Text>
                </View>
                <Text variant="calloutStrong" tone="brand">
                  {tr('sell.use')}
                </Text>
              </Pressable>
            ) : (
              item && (
                <Text variant="caption" tone="tertiary">
                  {tr('sell.noMarket')}
                </Text>
              )
            )}
            {item && item.grades.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text variant="calloutStrong">
                  {tr('sell.grade')}{' '}
                  <Text variant="caption" tone="tertiary">
                    {tr('common.optional')}
                  </Text>
                </Text>
                <View style={styles.chips}>
                  {item.grades.map((g) => (
                    <Chip
                      key={g}
                      label={tr('farmer.gradeShort', { grade: g })}
                      selected={grade === g}
                      onPress={() => setGrade(grade === g ? null : g)}
                    />
                  ))}
                </View>
              </View>
            )}
            {priceCents && qtyNum > 0 && (
              <Text variant="callout" tone="secondary" numeric>
                {tr('sell.worth', { amount: kes(Math.round(priceCents * qtyNum)) })}
              </Text>
            )}
          </View>
        );
      case 'when':
        return (
          <View style={{ gap: 18 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('sell.when')}
            </Text>
            <DayPicker
              label={tr('sell.readyFrom')}
              start={today}
              days={30}
              value={from}
              onChange={(v) => {
                setFrom(v);
                if (to < v) setTo(isoDay(addDays(new Date(v), 7)));
              }}
            />
            <DayPicker
              label={tr('sell.availableUntil')}
              start={new Date(from)}
              days={45}
              value={to}
              onChange={setTo}
            />
            {errors.to && (
              <Text variant="caption" tone="danger" accessibilityRole="alert">
                {errors.to}
              </Text>
            )}
            <Text variant="callout" tone="secondary">
              {tr('sell.whenSummary', { from: dateLong(from), to: dateLong(to) })}
            </Text>
          </View>
        );
      case 'photos':
        return (
          <View style={{ gap: 16 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('sell.photosTitle')}
            </Text>
            <Text variant="callout" tone="secondary">
              {tr('sell.photosHint')}
            </Text>
            <PhotoStrip
              bucket="produce-photos"
              photos={photos}
              onChange={setPhotos}
              max={6}
              size={size === 'compact' ? 92 : 110}
            />
            <TextField
              label={tr('sell.notes')}
              optional
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={500}
              placeholder={tr('sell.notesPlaceholder')}
            />
          </View>
        );
      case 'review':
        return (
          <View style={{ gap: 16 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('sell.review')}
            </Text>
            <Summary
              farm={farm}
              item={item}
              quantity={qtyNum}
              priceCents={priceCents}
              grade={grade}
              from={from}
              to={to}
              photos={photos}
              onEdit={setStep}
            />
            {notes.trim() && (
              <Card style={{ gap: 4 }}>
                <Text variant="caption" tone="secondary">
                  {tr('sell.notes')}
                </Text>
                <Text variant="body">{notes.trim()}</Text>
              </Card>
            )}
            <Banner tone="info" message={tr('sell.reviewNote')} />
          </View>
        );
    }
  })();

  const footer = (
    <View
      style={[
        styles.footer,
        {
          borderTopColor: t.colors.line,
          paddingBottom: (tabBar && size === 'compact' ? 0 : insets.bottom) + 12,
          backgroundColor: t.colors.bg,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', gap: 10, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        {step === 'review' ? (
          <>
            <Button
              label={tr('sell.saveDraft')}
              variant="outline"
              fullWidth={false}
              onPress={() => submit(true)}
              disabled={create.isPending}
              style={{ flex: 1 }}
            />
            <Button
              label={tr('sell.publish')}
              icon="check"
              onPress={() => submit(false)}
              loading={create.isPending}
              style={{ flex: 1.4 }}
            />
          </>
        ) : (
          <Button
            label={tr('common.continue')}
            iconRight="forward"
            onPress={next}
            disabled={step === 'farm' && farmList.length === 0}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={title} onBack={back} back={index > 0 || dirty || agentMode} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: wide ? 32 : 20,
          paddingTop: 4,
          gap: 20,
          width: '100%',
          maxWidth: wide ? t.layout.contentMax : 720,
          alignSelf: 'center',
        }}
      >
        <StepBar step={index} total={STEPS.length} label={tr(`sell.step.${step}`)} />
        {!agentMode && me?.farmerProfile?.kycStatus === 'REJECTED' && (
          <Banner tone="warning" message={tr('sell.kycRejected')} />
        )}
        {wide && step !== 'review' ? (
          <View style={{ flexDirection: 'row', gap: 28, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.5 }}>{body}</View>
            <View style={{ flex: 1, gap: 10 }}>
              <Text variant="calloutStrong" tone="secondary">
                {tr('sell.preview')}
              </Text>
              <Summary
                farm={farm}
                item={item}
                quantity={qtyNum}
                priceCents={priceCents}
                grade={grade}
                from={from}
                to={to}
                photos={photos}
              />
            </View>
          </View>
        ) : (
          body
        )}
      </ScrollView>
      {footer}
      <FarmSheet
        visible={farmSheet}
        onClose={() => setFarmSheet(false)}
        onSaved={(f) => {
          setFarmId(f.id);
          setFarmSheet(false);
        }}
      />
    </View>
  );
}

function ProduceStep({
  list,
  loading,
  error,
  retry,
  value,
  onChange,
  errorText,
}: {
  list: ProduceDto[] | undefined;
  loading: boolean;
  error: unknown;
  retry: () => void;
  value: string | null;
  onChange: (id: string) => void;
  errorText?: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const cats = CATEGORIES.filter((c) => list?.some((p) => p.category === c && p.active));
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter(
      (p) =>
        p.active &&
        (!cat || p.category === cat) &&
        (!s || p.name.toLowerCase().includes(s) || p.nameSw.toLowerCase().includes(s)),
    );
  }, [list, q, cat]);
  const cols = size === 'expanded' ? 4 : size === 'medium' ? 4 : 3;

  return (
    <View style={{ gap: 14 }}>
      <Text variant="title2" accessibilityRole="header">
        {tr('sell.whatSelling')}
      </Text>
      <SearchField value={q} onChangeText={setQ} placeholder={tr('sell.searchProduce')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label={tr('catalog.filter.all')} selected={!cat} onPress={() => setCat(null)} />
        {cats.map((c) => (
          <Chip
            key={c}
            label={tr(`sell.cat.${c}`)}
            selected={cat === c}
            onPress={() => setCat(cat === c ? null : c)}
          />
        ))}
      </ScrollView>
      {loading ? (
        <View style={styles.grid}>
          {['s1', 's2', 's3', 's4', 's5', 's6'].map((k) => (
            <View key={k} style={{ width: `${100 / cols}%`, padding: 5 }}>
              <Skeleton height={112} radius={14} />
            </View>
          ))}
        </View>
      ) : error ? (
        <ErrorState onRetry={retry} />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          art="noResults"
          title={tr('sell.noProduceMatch')}
          body={tr('sell.noProduceMatchBody')}
        />
      ) : (
        <View style={[styles.grid, { marginHorizontal: -5 }]}>
          {items.map((p) => {
            const selected = p.id === value;
            return (
              <View key={p.id} style={{ width: `${100 / cols}%`, padding: 5 }}>
                <Pressable
                  onPress={() => onChange(p.id)}
                  haptics="selection"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={produceName(p)}
                  focusRadius={t.radius.md}
                  style={({ hovered }) => [
                    styles.tile,
                    {
                      borderRadius: t.radius.md,
                      borderColor: selected ? t.colors.primary : t.colors.line,
                      backgroundColor: selected
                        ? t.colors.primaryTint
                        : hovered
                          ? t.colors.surfaceMuted
                          : t.colors.surface,
                    },
                  ]}
                >
                  <ProduceImage uri={p.imageUrl} category={p.category} produce={p} size={56} radius={28} />
                  <Text variant="calloutStrong" align="center" numberOfLines={2}>
                    {produceName(p)}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {tr('common.perUnit', { unit: unitLabel(p.unit) })}
                  </Text>
                  {selected && (
                    <View style={styles.tick}>
                      <Icon name="checkCircle" size={20} color={t.colors.primary} weight="fill" />
                    </View>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      {errorText && (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {errorText}
        </Text>
      )}
    </View>
  );
}

/** Horizontal strip of day chips. */
function DayPicker({
  label,
  start,
  days,
  value,
  onChange,
}: {
  label: string;
  start: Date;
  days: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  const { i18n } = useTranslation();
  const locale = i18n.language === 'sw' ? 'sw-KE' : 'en-KE';
  const list = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [start, days]);
  return (
    <View style={{ gap: 8 }}>
      <Text variant="calloutStrong">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {list.map((d) => {
          const iso = isoDay(d);
          const selected = iso === value;
          return (
            <Pressable
              key={iso}
              onPress={() => onChange(iso)}
              haptics="selection"
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${dateLong(d)}`}
              focusRadius={t.radius.md}
              style={[
                styles.day,
                {
                  borderRadius: t.radius.md,
                  borderColor: selected ? t.colors.primary : t.colors.line,
                  backgroundColor: selected ? t.colors.primary : t.colors.surface,
                },
              ]}
            >
              <Text
                variant="caption"
                style={{ color: selected ? t.colors.textOnBrandMuted : t.colors.textTertiary }}
              >
                {d.toLocaleDateString(locale, { weekday: 'short' })}
              </Text>
              <Text variant="headline" numeric style={{ color: selected ? '#FFFFFF' : t.colors.text }}>
                {d.getDate()}
              </Text>
              <Text
                variant="caption"
                style={{ color: selected ? t.colors.textOnBrandMuted : t.colors.textTertiary }}
              >
                {d.toLocaleDateString(locale, { month: 'short' })}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Listing as it will read, with edit links in review. */
function Summary({
  farm,
  item,
  quantity,
  priceCents,
  grade,
  from,
  to,
  photos,
  onEdit,
}: {
  farm: FarmDto | null;
  item: ProduceDto | null;
  quantity: number;
  priceCents: number | null;
  grade: string | null;
  from: string;
  to: string;
  photos: UploadedPhoto[];
  onEdit?: (s: Step) => void;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const rows: { key: Step; label: string; value: string }[] = [
    {
      key: 'farm',
      label: tr('sell.step.farm'),
      value: farm ? `${farm.name}, ${farm.county}` : tr('sell.notSet'),
    },
    { key: 'produce', label: tr('sell.step.produce'), value: item ? produceName(item) : tr('sell.notSet') },
    {
      key: 'amount',
      label: tr('sell.step.amount'),
      value:
        item && quantity > 0 && priceCents
          ? `${qty(quantity)} ${unitLabel(item.unit, quantity)} · ${kes(priceCents)} ${tr('common.perUnit', { unit: unitLabel(item.unit) })}${grade ? ` · ${tr('farmer.gradeShort', { grade })}` : ''}`
          : tr('sell.notSet'),
    },
    {
      key: 'when',
      label: tr('sell.step.when'),
      value: tr('farmer.dateRange', { from: relativeDay(from), to: dateShort(to) }),
    },
    {
      key: 'photos',
      label: tr('sell.step.photos'),
      value: photos.length ? tr('sell.photoCount', { count: photos.length }) : tr('sell.noPhotos'),
    },
  ];
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <ProduceImage
          uri={photos[0]?.uri ?? item?.imageUrl}
          category={item?.category}
          produce={item}
          size={64}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{item ? produceName(item) : tr('sell.yourProduce')}</Text>
          <Text variant="price" tone="brand" numeric>
            {priceCents ? kes(priceCents) : tr('sell.noPrice')}
          </Text>
        </View>
      </View>
      <Divider />
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="secondary">
              {r.label}
            </Text>
            <Text variant="callout" numeric>
              {r.value}
            </Text>
          </View>
          {onEdit && (
            <Text
              variant="calloutStrong"
              tone="brand"
              onPress={() => onEdit(r.key)}
              accessibilityRole="button"
              accessibilityLabel={`${tr('common.edit')} ${r.label}`}
              style={{ padding: 6, color: t.colors.primary }}
            >
              {tr('common.edit')}
            </Text>
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1.5 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    minHeight: 132,
  },
  tick: { position: 'absolute', top: 6, right: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  day: { width: 64, paddingVertical: 10, alignItems: 'center', borderWidth: 1.5, gap: 2 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
