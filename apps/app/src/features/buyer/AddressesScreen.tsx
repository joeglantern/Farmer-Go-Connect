import { AddressInput } from '@farmgo/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  type Address,
  type AddressBody,
  addressLine,
  useAddresses,
  useAddressMutations,
} from '../../data/addresses';
import { humanError } from '../../lib/errors';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Card, Pill, Switch } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { CountyPicker, LocationButton, SelectField } from '../../ui/Pickers';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import LeafletMap from '../maps/LeafletMap';

const MAX = 20;

/** Saved delivery addresses (B08), shared across the buyer's organization. */
export function AddressesScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const list = useAddresses();
  const { update, remove } = useAddressMutations();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const rows = list.data ?? [];
  const full = rows.length >= MAX;

  const makeDefault = async (a: Address) => {
    try {
      await update.mutateAsync({ id: a.id, body: { isDefault: true } });
      toast.success(tr('addresses.madeDefault', { label: a.label }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const del = async (a: Address) => {
    const ok = await dialog.confirm({
      title: tr('addresses.deleteTitle', { label: a.label }),
      message:
        a.isDefault && rows.length > 1 ? tr('addresses.deleteDefaultBody') : tr('addresses.deleteBody'),
      confirmLabel: tr('addresses.delete'),
      destructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(a.id);
      toast.success(tr('addresses.deleted', { label: a.label }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const add = (
    <Button
      label={tr('addresses.add')}
      icon="plus"
      size="sm"
      fullWidth={false}
      disabled={full}
      onPress={() => setEditing('new')}
    />
  );

  return (
    <Screen
      header={
        <Header title={tr('addresses.title')} right={size !== 'compact' && rows.length ? add : undefined} />
      }
      maxWidth={size === 'compact' ? undefined : 880}
      refreshing={list.isRefetching}
      onRefresh={() => list.refetch()}
      footer={size === 'compact' && rows.length ? add : undefined}
    >
      <Text variant="callout" tone="secondary" style={{ marginBottom: 16 }}>
        {tr('addresses.intro')}
      </Text>
      {list.isLoading ? (
        <SkeletonList count={3} height={96} />
      ) : list.error ? (
        <ErrorState message={humanError(list.error)} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          art="noResults"
          title={tr('addresses.emptyTitle')}
          body={tr('addresses.emptyBody')}
          action={{ label: tr('addresses.add'), icon: 'plus', onPress: () => setEditing('new') }}
        />
      ) : (
        <View style={[styles.grid, { gap: 12 }]}>
          {rows.map((a) => (
            <View key={a.id} style={{ width: size === 'compact' ? '100%' : '48.9%' }}>
              <Card style={{ gap: 10 }}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: t.colors.primaryTint }]}>
                    <Icon
                      name={a.isDefault ? 'locationFilled' : 'location'}
                      size={18}
                      color={t.colors.primary}
                    />
                  </View>
                  <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                    {a.label}
                  </Text>
                  {a.isDefault && <Pill label={tr('addresses.default')} tone="brand" size="sm" />}
                </View>
                <Text variant="callout">{addressLine(a)}</Text>
                <Text variant="caption" tone="secondary">
                  {a.county}
                  {a.lat !== null ? ` · ${tr('addresses.pinned')}` : ''}
                </Text>
                {a.instructions ? (
                  <Text variant="caption" tone="tertiary" numberOfLines={2}>
                    {a.instructions}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {!a.isDefault && (
                    <Button
                      label={tr('addresses.makeDefault')}
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => makeDefault(a)}
                      loading={update.isPending && update.variables?.id === a.id}
                    />
                  )}
                  <View style={{ flex: 1 }} />
                  <IconButton
                    icon="edit"
                    label={tr('addresses.editLabel', { label: a.label })}
                    onPress={() => setEditing(a)}
                  />
                  <IconButton
                    icon="trash"
                    label={tr('addresses.deleteLabel', { label: a.label })}
                    onPress={() => del(a)}
                    color={t.colors.danger}
                  />
                </View>
              </Card>
            </View>
          ))}
        </View>
      )}
      {full && (
        <Text variant="caption" tone="tertiary" style={{ marginTop: 12 }}>
          {tr('addresses.max', { max: MAX })}
        </Text>
      )}
      <AddressSheet address={editing} isFirst={rows.length === 0} onClose={() => setEditing(null)} />
    </Screen>
  );
}

type Form = {
  label: string;
  county: string | null;
  town: string;
  line1: string;
  landmark: string;
  instructions: string;
  point: { lat: number; lng: number } | null;
  isDefault: boolean;
};

function formFor(a: Address | null): Form {
  return {
    label: a?.label ?? '',
    county: a?.county ?? null,
    town: a?.town ?? '',
    line1: a?.line1 ?? '',
    landmark: a?.landmark ?? '',
    instructions: a?.instructions ?? '',
    point: a && a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null,
    isDefault: a?.isDefault ?? false,
  };
}

function AddressSheet({
  address,
  isFirst,
  onClose,
}: {
  address: Address | 'new' | null;
  isFirst: boolean;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const toast = useToast();
  const { create, update } = useAddressMutations();
  const existing = address && address !== 'new' ? address : null;
  const [form, setForm] = useState<Form>(formFor(null));
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [pickCounty, setPickCounty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = address === 'new' ? 'new' : (existing?.id ?? null);
  if (key !== openedFor) {
    setOpenedFor(key);
    setForm(formFor(existing));
    setErrors({});
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    const body: AddressBody = {
      label: form.label.trim(),
      county: (form.county ?? '') as AddressBody['county'],
      town: form.town.trim() || undefined,
      line1: form.line1.trim(),
      landmark: form.landmark.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
      lat: form.point?.lat,
      lng: form.point?.lng,
      isDefault: form.isDefault || undefined,
    };
    const parsed = AddressInput.safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? 'form');
        e[k] ??= tr(`addresses.errors.${k}`, { defaultValue: tr('addresses.errors.form') });
      }
      setErrors(e);
      return;
    }
    setErrors({});
    try {
      if (existing) {
        await update.mutateAsync({ id: existing.id, body: parsed.data });
        toast.success(tr('addresses.saved', { label: parsed.data.label }));
      } else {
        await create.mutateAsync(parsed.data);
        toast.success(tr('addresses.added', { label: parsed.data.label }));
      }
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={!!address}
      onClose={onClose}
      dismissible={!busy}
      title={existing ? tr('addresses.editTitle') : tr('addresses.addTitle')}
      maxWidth={640}
      footer={
        <Button
          label={existing ? tr('common.saveChanges') : tr('addresses.save')}
          onPress={submit}
          loading={busy}
        />
      }
    >
      <TextField
        label={tr('addresses.label')}
        placeholder={tr('addresses.labelPlaceholder')}
        value={form.label}
        onChangeText={(v) => set('label', v)}
        error={errors.label}
        autoCapitalize="words"
      />
      <SelectField
        label={tr('addresses.county')}
        value={form.county}
        placeholder={tr('addresses.pickCounty')}
        onPress={() => setPickCounty(true)}
        error={errors.county}
        icon="location"
      />
      <CountyPicker
        visible={pickCounty}
        onClose={() => setPickCounty(false)}
        value={form.county}
        onSelect={(c) => set('county', c)}
      />
      <TextField
        label={tr('addresses.town')}
        placeholder={tr('addresses.townPlaceholder')}
        value={form.town}
        onChangeText={(v) => set('town', v)}
        optional
      />
      <TextField
        label={tr('addresses.line1')}
        placeholder={tr('addresses.line1Placeholder')}
        value={form.line1}
        onChangeText={(v) => set('line1', v)}
        error={errors.line1}
      />
      <TextField
        label={tr('addresses.landmark')}
        placeholder={tr('addresses.landmarkPlaceholder')}
        value={form.landmark}
        onChangeText={(v) => set('landmark', v)}
        optional
      />
      <TextField
        label={tr('addresses.instructions')}
        placeholder={tr('addresses.instructionsPlaceholder')}
        value={form.instructions}
        onChangeText={(v) => set('instructions', v)}
        multiline
        numberOfLines={2}
        optional
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('addresses.pin')}</Text>
        <Text variant="caption" tone="secondary">
          {tr('addresses.pinHint')}
        </Text>
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line }}>
          <LeafletMap
            markers={
              form.point
                ? [{ id: 'pin', lat: form.point.lat, lng: form.point.lng, kind: 'buyer', label: form.label }]
                : []
            }
            pickable
            onPick={(lat, lng) => set('point', { lat, lng })}
            center={form.point ? [form.point.lat, form.point.lng] : undefined}
            dark={t.scheme === 'dark'}
            height={220}
          />
        </View>
        <LocationButton value={form.point} onChange={(p) => set('point', p)} />
        {form.point && (
          <Button
            label={tr('addresses.clearPin')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => set('point', null)}
          />
        )}
      </View>
      {isFirst && !existing ? (
        <Text variant="caption" tone="tertiary">
          {tr('addresses.firstIsDefault')}
        </Text>
      ) : existing?.isDefault ? null : (
        <Switch
          value={form.isDefault}
          onChange={(v) => set('isDefault', v)}
          label={tr('addresses.makeDefault')}
          description={tr('addresses.defaultHint')}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
});
