import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Checkbox } from '../../ui/Controls';
import { CountyPicker, LocationButton, SelectField } from '../../ui/Pickers';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

export interface FarmDraft {
  name: string;
  county: string | null;
  ward: string;
  acreage: string;
  isOrganic: boolean;
  point: { lat: number; lng: number } | null;
}

export const emptyFarm = (county: string | null = null): FarmDraft => ({
  name: '',
  county,
  ward: '',
  acreage: '',
  isOrganic: false,
  point: null,
});

export function farmErrors(f: FarmDraft, tr: (k: string) => string): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.farmName = tr('setup.farmNameRequired');
  if (!f.county) e.farmCounty = tr('setup.countyPlaceholder');
  const a = Number(f.acreage);
  if (f.acreage && (!Number.isFinite(a) || a <= 0 || a > 100_000)) e.acreage = tr('agent.acreageInvalid');
  return e;
}

/** Body for FarmInput. Call only after farmErrors() is empty. */
export function farmBody(f: FarmDraft) {
  return {
    name: f.name.trim(),
    county: f.county!,
    ...(f.ward.trim() ? { ward: f.ward.trim() } : {}),
    ...(f.acreage ? { acreage: Number(f.acreage) } : {}),
    ...(f.point ?? {}),
    isOrganic: f.isOrganic,
  };
}

/** Farm name, county, ward, size, organic and GPS pin. */
export function FarmFields({
  value,
  onChange,
  errors,
}: {
  value: FarmDraft;
  onChange: (v: FarmDraft) => void;
  errors: Record<string, string>;
}) {
  const { t: tr } = useTranslation();
  const [picker, setPicker] = useState(false);
  const set = (p: Partial<FarmDraft>) => onChange({ ...value, ...p });
  return (
    <View style={{ gap: 16 }}>
      <TextField
        label={tr('setup.farmName')}
        placeholder={tr('setup.farmNamePlaceholder')}
        value={value.name}
        onChangeText={(name) => set({ name })}
        autoCapitalize="words"
        error={errors.farmName}
        maxLength={120}
      />
      <SelectField
        label={tr('setup.county')}
        value={value.county}
        placeholder={tr('setup.countyPlaceholder')}
        onPress={() => setPicker(true)}
        error={errors.farmCounty}
        icon="location"
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TextField
          containerStyle={{ flex: 1.4 }}
          label={tr('agent.ward')}
          optional
          placeholder={tr('agent.wardPlaceholder')}
          value={value.ward}
          onChangeText={(ward) => set({ ward })}
          autoCapitalize="words"
          maxLength={80}
        />
        <TextField
          containerStyle={{ flex: 1 }}
          label={tr('setup.acreage')}
          optional
          placeholder="2.5"
          value={value.acreage}
          onChangeText={(v) => set({ acreage: v.replace(/[^\d.]/g, '') })}
          keyboardType="decimal-pad"
          error={errors.acreage}
        />
      </View>
      <Checkbox
        checked={value.isOrganic}
        onChange={(isOrganic) => set({ isOrganic })}
        label={tr('agent.organic')}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('agent.pinFarm')}</Text>
        <Text variant="caption" tone="tertiary">
          {tr('agent.pinFarmHint')}
        </Text>
        <LocationButton value={value.point} onChange={(point) => set({ point })} />
      </View>
      <CountyPicker
        visible={picker}
        onClose={() => setPicker(false)}
        value={value.county}
        onSelect={(county) => set({ county })}
      />
    </View>
  );
}
