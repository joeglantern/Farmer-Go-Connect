import type { InspectionResultDto, QaTaskDto } from '@farmgo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { callPhone, openDirections, useQaTask } from '../../../features/qa/data';
import { PhotoStrip, type UploadedPhoto } from '../../../features/qa/PhotoStrip';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { dateShort, produceName, qty, unitLabel } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button, IconButton } from '../../../ui/Button';
import { Card, Checkbox, Chip, Divider, Pill, Segmented, Stepper } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { ProduceImage } from '../../../ui/Media';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Pressable } from '../../../ui/Pressable';
import { Header, Screen } from '../../../ui/Screen';
import { Skeleton, SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

type Item = QaTaskDto['items'][number];
type Location = 'FARM_GATE' | 'AGGREGATION_CENTRE' | 'BUYER_DOOR';

const CHECKS = ['fresh', 'noPests', 'noDamage', 'sizeUniform', 'clean', 'packed'] as const;
type CheckKey = (typeof CHECKS)[number];

interface Draft {
  grade: string;
  passed: boolean;
  acceptedQty: number;
  rejectedQty: number;
  rejectReason: string;
  notes: string;
  checklist: Record<CheckKey, boolean>;
  photos: UploadedPhoto[];
}

function initialDraft(it: Item): Draft {
  const grades = it.listing.produce.grades;
  return {
    grade: it.listing.grade && grades.includes(it.listing.grade) ? it.listing.grade : (grades[0] ?? 'A'),
    passed: true,
    acceptedQty: it.quantity,
    rejectedQty: 0,
    rejectReason: '',
    notes: '',
    checklist: {
      fresh: false,
      noPests: false,
      noDamage: false,
      sizeUniform: false,
      clean: false,
      packed: false,
    },
    photos: [],
  };
}

/** Farm-gate inspection: one card per order item, submitted together. */
export default function Inspection() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const qc = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const task = useQaTask(orderId);
  const order = task.data;
  const pending = useMemo(() => order?.items.filter((i) => !i.inspection) ?? [], [order]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [location, setLocation] = useState<Location>('FARM_GATE');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!order) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const it of order.items) if (!it.inspection && !next[it.id]) next[it.id] = initialDraft(it);
      return next;
    });
  }, [order]);

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  const problems = pending.filter((it) => {
    const d = drafts[it.id];
    if (!d) return true;
    const needsReason = (!d.passed || d.rejectedQty > 0) && d.rejectReason.trim().length < 3;
    return needsReason || (!d.passed && d.photos.length === 0);
  });
  const failures = pending.filter((it) => drafts[it.id] && !drafts[it.id]!.passed);

  const submit = async () => {
    if (!order) return;
    if (problems.length) {
      setShowErrors(true);
      toast.error(tr('qa.fixErrors'));
      return;
    }
    if (failures.length) {
      const ok = await dialog.confirm({
        title: tr('qa.confirmFailTitle', { count: failures.length }),
        message: tr('qa.confirmFailBody', { buyer: order.buyerOrg.name }),
        confirmLabel: tr('qa.confirmFail'),
        cancelLabel: tr('qa.reviewAgain'),
        destructive: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    setSaving(true);
    let last: InspectionResultDto | null = null;
    try {
      for (const it of pending) {
        const d = drafts[it.id]!;
        last = await api.post<InspectionResultDto>('/v1/qa/inspections', {
          orderItemId: it.id,
          grade: d.grade,
          passed: d.passed,
          acceptedQty: d.acceptedQty,
          rejectedQty: d.rejectedQty,
          rejectReason: d.rejectReason.trim() || undefined,
          checklist: d.checklist,
          notes: d.notes.trim() || undefined,
          photos: d.photos.map((p) => p.key),
          location,
        });
      }
      void qc.invalidateQueries({ queryKey: ['qaTasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['qaInspections'] });
      const status = last?.orderStatus;
      toast.success(
        status === 'QA_REJECTED'
          ? tr('qa.savedRejected')
          : status === 'QA_PASSED'
            ? tr('qa.savedPassed')
            : tr('qa.saved'),
      );
      router.back();
    } catch (err) {
      // Items saved before the error are now inspected; refetch so they drop out of the form.
      void qc.invalidateQueries({ queryKey: ['qaTasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.error(humanError(err));
    } finally {
      setSaving(false);
    }
  };

  const farm = order?.items[0]?.listing.farm;
  const header = (
    <Header
      title={farm?.name ?? tr('qa.inspectionTitle')}
      subtitle={order ? `${order.code} · ${order.buyerOrg.name}` : undefined}
    />
  );

  if (task.isLoading) {
    return (
      <Screen header={header} maxWidth={880}>
        <View style={{ gap: 16 }}>
          <Skeleton height={120} radius={14} />
          <SkeletonList count={2} height={320} />
        </View>
      </Screen>
    );
  }
  if (task.error) {
    return (
      <Screen header={header}>
        <ErrorState onRetry={() => void task.refetch()} />
      </Screen>
    );
  }
  if (!order) {
    return (
      <Screen header={header}>
        <EmptyState
          art="noResults"
          title={tr('qa.goneTitle')}
          body={tr('qa.goneBody')}
          action={{ label: tr('qa.backToTasks'), onPress: () => router.back(), icon: 'back' }}
        />
      </Screen>
    );
  }

  const farmer = farm?.farmer.user;
  const wide = size === 'expanded';

  return (
    <Screen
      header={header}
      maxWidth={wide ? 1180 : 760}
      refreshing={task.isRefetching}
      onRefresh={() => void task.refetch()}
      footer={
        pending.length > 0 ? (
          <View style={styles.footer}>
            {!wide && (
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="secondary">
                  {tr('qa.itemsToSubmit', { count: pending.length })}
                </Text>
                {failures.length > 0 && (
                  <Text variant="calloutStrong" tone="danger">
                    {tr('qa.failingCount', { count: failures.length })}
                  </Text>
                )}
              </View>
            )}
            <Button
              label={failures.length ? tr('qa.submitWithFailures') : tr('qa.submit')}
              variant={failures.length ? 'danger' : 'primary'}
              icon="checkCircle"
              loading={saving}
              onPress={() => void submit()}
              fullWidth={wide}
              style={wide ? undefined : { flex: 1.3 }}
            />
          </View>
        ) : undefined
      }
    >
      <View style={[styles.layout, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={[{ gap: 16 }, wide && { width: 340 }]}>
          <Card style={{ gap: 14 }}>
            <View style={styles.farmRow}>
              <View
                style={[
                  styles.farmIcon,
                  { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.sm },
                ]}
              >
                <Icon name="farm" size={24} color={t.colors.primary} weight="duotone" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline">{farmer?.name ?? farm?.name}</Text>
                <Text variant="caption" tone="secondary">
                  {[farm?.ward, farm?.county].filter(Boolean).join(', ')}
                </Text>
              </View>
              <IconButton
                icon="phone"
                label={tr('qa.callFarmer', { name: farmer?.name ?? '' })}
                variant="tinted"
                disabled={!farmer?.phoneNumber}
                onPress={() => callPhone(farmer?.phoneNumber)}
              />
              <IconButton
                icon="navigate"
                label={tr('qa.directions')}
                variant="tinted"
                onPress={() => openDirections(farm?.lat, farm?.lng, farm?.name ?? '')}
              />
            </View>
            <Divider />
            <View style={styles.kv}>
              <Text variant="callout" tone="secondary">
                {tr('qa.delivery')}
              </Text>
              <Text variant="calloutStrong">{dateShort(order.deliveryDate)}</Text>
            </View>
            <View style={styles.kv}>
              <Text variant="callout" tone="secondary">
                {tr('qa.buyer')}
              </Text>
              <Text variant="calloutStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {order.buyerOrg.name}
              </Text>
            </View>
          </Card>
          {pending.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text variant="calloutStrong">{tr('qa.whereInspecting')}</Text>
              <Segmented
                value={location}
                onChange={setLocation}
                options={[
                  { value: 'FARM_GATE', label: tr('qa.loc.FARM_GATE') },
                  { value: 'AGGREGATION_CENTRE', label: tr('qa.loc.AGGREGATION_CENTRE') },
                  { value: 'BUYER_DOOR', label: tr('qa.loc.BUYER_DOOR') },
                ]}
              />
            </View>
          )}
          {wide && pending.length > 0 && failures.length > 0 && (
            <Banner tone="danger" message={tr('qa.failingCount', { count: failures.length })} />
          )}
        </View>

        <View style={{ flex: 1, gap: 16 }}>
          {order.items.map((it) =>
            it.inspection ? (
              <DoneItem key={it.id} item={it} />
            ) : drafts[it.id] ? (
              <ItemForm
                key={it.id}
                item={it}
                draft={drafts[it.id]!}
                onChange={(p) => update(it.id, p)}
                showErrors={showErrors}
              />
            ) : null,
          )}
          {pending.length === 0 && (
            <Banner
              tone="success"
              message={tr('qa.allDone')}
              action={{ label: tr('qa.backToTasks'), onPress: () => router.back() }}
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

function ItemHead({ item, right }: { item: Item; right?: ReactNode }) {
  return (
    <View style={styles.itemHead}>
      <ProduceImage
        uri={item.listing.photoUrls[0] ?? item.listing.produce.imageUrl}
        category={item.listing.produce.category}
        produce={item.listing.produce}
        size={56}
        radius={12}
      />
      <View style={{ flex: 1 }}>
        <Text variant="title3" numberOfLines={1}>
          {produceName(item.listing.produce)}
        </Text>
        <Text variant="callout" tone="secondary" numeric>
          {qty(item.quantity)} {unitLabel(item.listing.produce.unit, item.quantity)}
          {item.listing.grade ? ` · ${item.listing.grade}` : ''}
        </Text>
      </View>
      {right}
    </View>
  );
}

function DoneItem({ item }: { item: Item }) {
  const { t: tr } = useTranslation();
  const ins = item.inspection!;
  const unit = unitLabel(item.listing.produce.unit, ins.acceptedQty);
  return (
    <Card style={{ gap: 10 }}>
      <ItemHead
        item={item}
        right={
          <Pill
            label={ins.passed ? tr('qa.passed') : tr('qa.failed')}
            tone={ins.passed ? 'success' : 'danger'}
            icon={ins.passed ? 'checkCircle' : 'error'}
          />
        }
      />
      <Text variant="callout" tone="secondary">
        {tr('qa.doneSummary', { grade: ins.grade, accepted: `${qty(ins.acceptedQty)} ${unit}` })}
        {ins.rejectReason ? ` · ${ins.rejectReason}` : ''}
      </Text>
    </Card>
  );
}

function ItemForm({
  item,
  draft,
  onChange,
  showErrors,
}: {
  item: Item;
  draft: Draft;
  onChange: (p: Partial<Draft>) => void;
  showErrors: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const total = item.quantity;
  const unit = item.listing.produce.unit;
  const step = unit === 'KG' && total >= 50 ? 5 : 1;
  const grades = item.listing.produce.grades.length ? item.listing.produce.grades : ['A', 'B', 'C'];
  const needsReason = !draft.passed || draft.rejectedQty > 0;
  const reasonError =
    showErrors && needsReason && draft.rejectReason.trim().length < 3 ? tr('qa.reasonRequired') : null;
  const photoError = showErrors && !draft.passed && draft.photos.length === 0 ? tr('qa.photoRequired') : null;
  const checked = CHECKS.filter((c) => draft.checklist[c]).length;

  const setRejected = (r: number) => {
    const rejected = Math.min(total, Math.max(0, r));
    onChange({ rejectedQty: rejected, acceptedQty: Number((total - rejected).toFixed(2)) });
  };
  const setVerdict = (passed: boolean) => {
    if (passed === draft.passed) return;
    onChange(
      passed
        ? { passed, acceptedQty: total, rejectedQty: 0 }
        : { passed, acceptedQty: 0, rejectedQty: total },
    );
  };

  return (
    <Card style={{ gap: 18, borderWidth: draft.passed ? 0 : 1.5, borderColor: t.colors.danger }}>
      <ItemHead item={item} />

      <View style={styles.verdictRow}>
        <Verdict
          label={tr('qa.pass')}
          icon="checkCircle"
          active={draft.passed}
          tone="success"
          onPress={() => setVerdict(true)}
        />
        <Verdict
          label={tr('qa.fail')}
          icon="error"
          active={!draft.passed}
          tone="danger"
          onPress={() => setVerdict(false)}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('qa.grade')}</Text>
        <View style={styles.chips}>
          {grades.map((g) => (
            <Chip key={g} label={g} selected={draft.grade === g} onPress={() => onChange({ grade: g })} />
          ))}
        </View>
      </View>

      <View style={styles.qtyRow}>
        <View style={styles.qtyBox}>
          <Text variant="caption" tone="secondary">
            {tr('qa.accepted')}
          </Text>
          <Text variant="display" numeric style={{ color: t.colors.success }}>
            {qty(draft.acceptedQty)}
          </Text>
          <Text variant="caption" tone="tertiary">
            {unitLabel(unit, draft.acceptedQty)}
          </Text>
        </View>
        <View style={styles.qtyBox}>
          <Text variant="caption" tone="secondary">
            {tr('qa.rejected')}
          </Text>
          <Stepper
            value={draft.rejectedQty}
            onChange={setRejected}
            min={0}
            max={total}
            step={step}
            size="lg"
            label={tr('qa.rejected')}
          />
          <Text variant="caption" tone="tertiary">
            {tr('qa.ofTotal', { total: `${qty(total)} ${unitLabel(unit, total)}` })}
          </Text>
        </View>
      </View>

      {needsReason && (
        <TextField
          label={tr('qa.rejectReason')}
          placeholder={tr('qa.rejectReasonHint')}
          value={draft.rejectReason}
          onChangeText={(v) => onChange({ rejectReason: v })}
          error={reasonError}
          multiline
          maxLength={500}
        />
      )}

      <View style={{ gap: 4 }}>
        <View style={styles.kv}>
          <Text variant="calloutStrong">{tr('qa.checklist')}</Text>
          <Text variant="caption" tone="tertiary" numeric>
            {checked}/{CHECKS.length}
          </Text>
        </View>
        {CHECKS.map((c) => (
          <Checkbox
            key={c}
            label={tr(`qa.check.${c}`)}
            checked={draft.checklist[c]}
            onChange={(v) => onChange({ checklist: { ...draft.checklist, [c]: v } })}
          />
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">
          {tr('qa.photos')}
          {draft.passed ? (
            <Text variant="caption" tone="tertiary">
              {`  ${tr('common.optional')}`}
            </Text>
          ) : null}
        </Text>
        <PhotoStrip bucket="qa-evidence" photos={draft.photos} onChange={(photos) => onChange({ photos })} />
        {photoError && (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {photoError}
          </Text>
        )}
      </View>

      <TextField
        label={tr('qa.notes')}
        optional
        placeholder={tr('qa.notesHint')}
        value={draft.notes}
        onChangeText={(v) => onChange({ notes: v })}
        multiline
        maxLength={1000}
      />
    </Card>
  );
}

function Verdict({
  label,
  icon,
  active,
  tone,
  onPress,
}: {
  label: string;
  icon: 'checkCircle' | 'error';
  active: boolean;
  tone: 'success' | 'danger';
  onPress: () => void;
}) {
  const t = useTheme();
  const fg = tone === 'success' ? t.colors.success : t.colors.danger;
  const tint = tone === 'success' ? t.colors.successTint : t.colors.dangerTint;
  return (
    <Pressable
      onPress={onPress}
      haptics={tone === 'danger' ? 'warning' : 'selection'}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      focusRadius={t.radius.md}
      style={[
        styles.verdict,
        {
          borderRadius: t.radius.md,
          borderColor: active ? fg : t.colors.lineStrong,
          backgroundColor: active ? tint : t.colors.surface,
        },
      ]}
    >
      <Icon
        name={icon}
        size={24}
        color={active ? fg : t.colors.textTertiary}
        weight={active ? 'fill' : 'regular'}
      />
      <Text variant="headline" style={{ color: active ? fg : t.colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layout: { gap: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  farmRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  farmIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  verdictRow: { flexDirection: 'row', gap: 12 },
  verdict: {
    flex: 1,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qtyRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  qtyBox: { flex: 1, minWidth: 150, gap: 6, alignItems: 'flex-start' },
});
