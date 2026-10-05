import type { County, FarmDto } from '@farmgo/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../data/session';
import { ApiError } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Controls';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { CountyPicker, LocationButton, SelectField } from '../../ui/Pickers';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import LeafletMap from '../maps/LeafletMap';
import { useDeleteFarm, useSaveFarm } from './data';

/** Add or edit a farm: name, county, ward, size, organic, and a pin on the map. */
export function FarmSheet({
  visible,
  onClose,
  onSaved,
  onDeleted,
  farm,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved?: (f: FarmDto) => void;
  /** After the farm is deleted or archived. */
  onDeleted?: () => void;
  farm?: FarmDto | null;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const save = useSaveFarm(farm?.id);
  const remove = useDeleteFarm(farm?.id ?? '');
  const dialog = useDialog();
  const [name, setName] = useState('');
  const [county, setCounty] = useState<string | null>(null);
  const [ward, setWard] = useState('');
  const [acreage, setAcreage] = useState('');
  const [organic, setOrganic] = useState(false);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [countyOpen, setCountyOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setName(farm?.name ?? '');
    setCounty(farm?.county ?? me?.user.county ?? null);
    setWard(farm?.ward ?? '');
    setAcreage(farm?.acreage ? String(farm.acreage) : '');
    setOrganic(farm?.isOrganic ?? false);
    setPoint(farm?.lat != null && farm.lng != null ? { lat: farm.lat, lng: farm.lng } : null);
    setErrors({});
  }, [visible, farm, me?.user.county]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = tr('farms.nameRequired');
    if (!county) e.county = tr('setup.countyPlaceholder');
    const acres = acreage.trim() ? Number(acreage.replace(',', '.')) : undefined;
    if (acres !== undefined && (!Number.isFinite(acres) || acres <= 0))
      e.acreage = tr('farms.acreageInvalid');
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const f = await save.mutateAsync({
        name: name.trim(),
        county: county as County,
        ward: ward.trim() || undefined,
        acreage: acres,
        isOrganic: organic,
        // An existing pin that was removed is cleared with nulls (B25).
        ...(point ?? (farm?.lat != null ? { lat: null, lng: null } : {})),
      });
      toast.success(farm ? tr('farms.saved') : tr('farms.added'));
      onSaved?.(f);
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const del = async () => {
    if (!farm) return;
    const ok = await dialog.confirm({
      title: tr('farms.deleteTitle', { name: farm.name }),
      message: tr('farms.deleteBody'),
      confirmLabel: tr('farms.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await remove.mutateAsync();
      toast.success(res.archived ? tr('farms.archived') : tr('farms.deleted'));
      onClose();
      onDeleted?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'FARM_IN_USE' ? tr('farms.inUse') : humanError(err),
      );
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={farm ? tr('farms.editTitle') : tr('farms.addTitle')}
      subtitle={tr('farms.sheetBody')}
      scroll
      maxWidth={620}
      footer={
        <Button
          label={farm ? tr('common.saveChanges') : tr('farms.add')}
          onPress={submit}
          loading={save.isPending}
        />
      }
    >
      <TextField
        label={tr('farms.name')}
        value={name}
        onChangeText={setName}
        placeholder={tr('farms.namePlaceholder')}
        error={errors.name}
        maxLength={120}
      />
      <SelectField
        label={tr('setup.county')}
        value={county}
        placeholder={tr('setup.countyPlaceholder')}
        onPress={() => setCountyOpen(true)}
        icon="location"
        error={errors.county}
      />
      <TextField label={tr('farms.ward')} optional value={ward} onChangeText={setWard} maxLength={80} />
      <TextField
        label={tr('farms.acreage')}
        optional
        value={acreage}
        onChangeText={(v) => setAcreage(v.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        error={errors.acreage}
      />
      <Switch
        value={organic}
        onChange={setOrganic}
        label={tr('farms.organic')}
        description={tr('farms.organicHint')}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('farms.pin')}</Text>
        <Text variant="caption" tone="secondary">
          {tr('farms.pinHint')}
        </Text>
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line }}>
          <LeafletMap
            markers={
              point
                ? [
                    {
                      id: 'farm',
                      lat: point.lat,
                      lng: point.lng,
                      kind: 'farm',
                      label: name || tr('farms.pin'),
                    },
                  ]
                : []
            }
            pickable
            onPick={(lat, lng) => setPoint({ lat, lng })}
            dark={t.scheme === 'dark'}
            height={220}
            zoom={point ? 15 : 7}
            center={point ? [point.lat, point.lng] : [-0.4, 37.2]}
            dom={{ scrollEnabled: false, matchContents: true }}
          />
        </View>
        <LocationButton value={point} onChange={setPoint} />
        {point && (
          <Button
            label={tr('farms.removePin')}
            icon="close"
            variant="ghost"
            size="sm"
            onPress={() => setPoint(null)}
          />
        )}
      </View>
      {farm && (
        <Button
          label={tr('farms.delete')}
          icon="trash"
          variant="ghost"
          size="md"
          onPress={del}
          loading={remove.isPending}
          style={{ marginTop: 8 }}
        />
      )}
      <CountyPicker
        visible={countyOpen}
        onClose={() => setCountyOpen(false)}
        value={county}
        onSelect={setCounty}
      />
    </Sheet>
  );
}
