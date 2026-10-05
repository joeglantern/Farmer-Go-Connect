import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useProduce } from '../../data/catalog';
import i18n from '../../i18n';
import { humanError } from '../../lib/errors';
import { kes, parseKes, produceName, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Chip, RadioRow } from '../../ui/Controls';
import { ProduceImage } from '../../ui/Media';
import { Banner } from '../../ui/overlays/Banner';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { SelectField } from '../../ui/Pickers';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField, TextField } from '../../ui/TextField';
import {
  type RequirementBody,
  type RequirementDetail,
  useRequirement,
  useRequirementMutations,
} from './data';
import { nextDates, REPEATS, type Repeat, repeatOf, toRRule } from './requirements';

type Produce = NonNullable<ReturnType<typeof useProduce>['data']>[number];

const locale = () => (i18n.language === 'sw' ? 'sw-KE' : 'en-KE');

function nextDays(n: number) {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  for (let i = 1; i <= n; i++) out.push(new Date(d.getTime() + i * 86_400_000));
  return out;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Post or edit a requirement. `id` switches to edit mode (produce cannot change then). */
export function RequirementFormScreen({ id, produceId }: { id?: string; produceId?: string }) {
  const { t: tr } = useTranslation();
  const existing = useRequirement(id);
  if (id && existing.isLoading) {
    return (
      <Screen header={<Header title={tr('requirements.editTitle')} />}>
        <View style={{ gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={tr('common.loading')}>
          <Skeleton height={60} />
          <Skeleton height={60} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }
  if (id && (existing.error || !existing.data)) {
    return (
      <Screen header={<Header title={tr('requirements.editTitle')} />}>
        <ErrorState message={humanError(existing.error)} onRetry={() => existing.refetch()} />
      </Screen>
    );
  }
  return <Form existing={existing.data ?? null} initialProduceId={produceId} />;
}

function Form({
  existing,
  initialProduceId,
}: {
  existing: RequirementDetail | null;
  initialProduceId?: string;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const toast = useToast();
  const produce = useProduce();
  const { create, update } = useRequirementMutations();
  const days = useMemo(() => nextDays(21), []);

  const [produceId, setProduceId] = useState<string | undefined>(existing?.produceId ?? initialProduceId);
  const [picking, setPicking] = useState(false);
  const [quantity, setQuantity] = useState(existing ? String(existing.quantity) : '');
  const [grade, setGrade] = useState<string | undefined>(existing?.minGrade ?? undefined);
  const [maxPrice, setMaxPrice] = useState(
    existing?.maxPricePerUnit ? kes(existing.maxPricePerUnit, { bare: true }) : '',
  );
  const [date, setDate] = useState<Date>(existing ? new Date(existing.neededBy) : days[1]!);
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(existing?.recurrence));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selected: Produce | undefined =
    (produce.data ?? []).find((p) => p.id === produceId) ?? existing?.produce;
  const busy = create.isPending || update.isPending;
  const editing = !!existing;

  const submit = async () => {
    const e: Record<string, string> = {};
    const q = Number(quantity.replace(',', '.'));
    const price = maxPrice.trim() ? parseKes(maxPrice) : null;
    if (!selected) e.produce = tr('requirements.errors.produce');
    if (!Number.isFinite(q) || q <= 0) e.quantity = tr('requirements.errors.quantity');
    if (maxPrice.trim() && !price) e.maxPrice = tr('requirements.errors.price');
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: RequirementBody = {
      produceId: selected!.id,
      quantity: q,
      minGrade: grade,
      maxPricePerUnit: price ?? undefined,
      neededBy: date.toISOString(),
      recurrence: toRRule(repeat, date),
      notes: notes.trim() || undefined,
    };
    try {
      if (existing) {
        const { produceId: _p, ...rest } = body;
        await update.mutateAsync({ id: existing.id, body: rest });
        toast.success(tr('requirements.saved'));
        router.back();
      } else {
        const d = await create.mutateAsync(body);
        toast.success(tr('requirements.posted', { name: produceName(d.produce) }));
        router.replace({ pathname: '/requirements/[id]', params: { id: d.id } });
      }
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const unit = selected ? unitLabel(selected.unit, 2) : '';

  return (
    <Screen
      header={<Header title={editing ? tr('requirements.editTitle') : tr('requirements.newTitle')} />}
      maxWidth={size === 'compact' ? undefined : t.layout.formMax + 80}
      footer={
        <Button
          label={editing ? tr('common.saveChanges') : tr('requirements.post')}
          onPress={submit}
          loading={busy}
        />
      }
    >
      <View style={{ gap: 18, paddingTop: 4 }}>
        {!editing && (
          <Text variant="callout" tone="secondary">
            {tr('requirements.intro')}
          </Text>
        )}
        <SelectField
          label={tr('requirements.produce')}
          value={selected ? produceName(selected) : null}
          placeholder={tr('requirements.pickProduce')}
          onPress={() => !editing && setPicking(true)}
          error={errors.produce}
        />
        {editing && (
          <Text variant="caption" tone="tertiary" style={{ marginTop: -12 }}>
            {tr('requirements.produceLocked')}
          </Text>
        )}
        <TextField
          label={tr('requirements.quantity')}
          placeholder="50"
          keyboardType="decimal-pad"
          value={quantity}
          onChangeText={(v) => setQuantity(v.replace(/[^\d.,]/g, ''))}
          suffix={
            unit ? (
              <Text variant="callout" tone="secondary">
                {unit}
              </Text>
            ) : undefined
          }
          error={errors.quantity}
        />
        {selected && selected.grades.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('requirements.minGrade')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip
                label={tr('requirements.anyGrade')}
                selected={!grade}
                onPress={() => setGrade(undefined)}
              />
              {selected.grades.map((g) => (
                <Chip
                  key={g}
                  label={tr('requirements.gradeN', { grade: g })}
                  selected={grade === g}
                  onPress={() => setGrade(g)}
                />
              ))}
            </View>
          </View>
        )}
        <TextField
          label={tr('requirements.maxPrice')}
          prefix="KES"
          placeholder="120"
          keyboardType="decimal-pad"
          value={maxPrice}
          onChangeText={setMaxPrice}
          hint={selected ? tr('requirements.maxPriceHint', { unit: unitLabel(selected.unit) }) : undefined}
          error={errors.maxPrice}
          optional
        />
        <View style={{ gap: 8 }}>
          <Text variant="calloutStrong">{tr('requirements.neededBy')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((d) => {
              const on = sameDay(d, date);
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => setDate(d)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={d.toLocaleDateString(locale(), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  focusRadius={14}
                  haptics="selection"
                  style={[
                    styles.day,
                    {
                      borderColor: on ? t.colors.primary : t.colors.lineStrong,
                      backgroundColor: on ? t.colors.primary : t.colors.surface,
                    },
                  ]}
                >
                  <Text
                    variant="micro"
                    style={{ color: on ? t.colors.textOnBrandMuted : t.colors.textTertiary }}
                  >
                    {d.toLocaleDateString(locale(), { weekday: 'short' }).toUpperCase()}
                  </Text>
                  <Text variant="title3" numeric style={{ color: on ? t.colors.textOnBrand : t.colors.text }}>
                    {d.getDate()}
                  </Text>
                  <Text
                    variant="micro"
                    style={{ color: on ? t.colors.textOnBrandMuted : t.colors.textTertiary }}
                  >
                    {d.toLocaleDateString(locale(), { month: 'short' })}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={{ gap: 8 }}>
          <Text variant="calloutStrong">{tr('requirements.repeat')}</Text>
          {REPEATS.map((r) => (
            <RadioRow
              key={r}
              label={tr(`requirements.repeatOption.${r}`)}
              description={
                r === 'none'
                  ? undefined
                  : tr(`requirements.repeatHint.${r}`, {
                      day: date.toLocaleDateString(locale(), { weekday: 'long' }),
                    })
              }
              selected={repeat === r}
              onPress={() => setRepeat(r)}
            />
          ))}
          {repeat !== 'none' && (
            <Text variant="caption" tone="secondary" numeric>
              {tr('requirements.nextDates', {
                dates: nextDates(repeat, date)
                  .map((d) =>
                    d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }),
                  )
                  .join(', '),
              })}
            </Text>
          )}
        </View>
        <TextField
          label={tr('requirements.notes')}
          placeholder={tr('requirements.notesPlaceholder')}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          optional
        />
        {repeat !== 'none' && <Banner tone="info" message={tr('requirements.recurringNote')} />}
      </View>
      <ProduceSheet
        visible={picking}
        onClose={() => setPicking(false)}
        items={produce.data ?? []}
        loading={produce.isLoading}
        error={produce.isError ? humanError(produce.error) : null}
        onRetry={() => produce.refetch()}
        onPick={(p) => {
          setProduceId(p.id);
          setGrade(undefined);
          setPicking(false);
        }}
        selectedId={produceId}
      />
    </Screen>
  );
}

function ProduceSheet({
  visible,
  onClose,
  items,
  loading,
  error,
  onRetry,
  onPick,
  selectedId,
}: {
  visible: boolean;
  onClose: () => void;
  items: Produce[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (p: Produce) => void;
  selectedId?: string;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const list = items.filter(
    (p) => !s || p.name.toLowerCase().includes(s) || p.nameSw.toLowerCase().includes(s),
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('requirements.pickProduce')} scroll={false}>
      <SearchField value={q} onChangeText={setQ} placeholder={tr('requirements.searchProduce')} autoFocus />
      {loading ? (
        <Skeleton height={200} />
      ) : error ? (
        <ErrorState compact message={error} onRetry={onRetry} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          style={{ maxHeight: 420 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            return (
              <Pressable
                onPress={() => onPick(item)}
                accessibilityRole="radio"
                accessibilityState={{ checked: item.id === selectedId }}
                accessibilityLabel={produceName(item)}
                haptics="selection"
                style={({ pressed, hovered }) => [
                  styles.produceRow,
                  {
                    borderRadius: t.radius.sm,
                    backgroundColor:
                      item.id === selectedId
                        ? t.colors.primaryTint
                        : pressed || hovered
                          ? t.colors.surfaceMuted
                          : 'transparent',
                  },
                ]}
              >
                <ProduceImage uri={item.imageUrl} category={item.category} size={40} radius={8} />
                <View style={{ flex: 1 }}>
                  <Text variant="body">{produceName(item)}</Text>
                  <Text variant="caption" tone="tertiary">
                    {tr('common.perUnit', { unit: unitLabel(item.unit) })}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  day: { width: 64, paddingVertical: 8, borderRadius: 14, borderWidth: 1, alignItems: 'center', gap: 2 },
  produceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 8 },
});
