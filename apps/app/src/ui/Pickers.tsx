import { COUNTIES } from '@farmgo/contracts';
import * as Location from 'expo-location';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './overlays/Sheet';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { SearchField, TextField } from './TextField';

/** Field that looks like an input and opens a picker. */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  error,
  icon = 'chevronDown',
}: {
  label: string;
  value?: string | null;
  placeholder: string;
  onPress: () => void;
  error?: string | null;
  icon?: 'chevronDown' | 'location' | 'calendar' | 'clock';
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="calloutStrong">{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        focusRadius={t.radius.sm}
        style={({ pressed }) => [
          styles.select,
          {
            borderColor: error ? t.colors.danger : t.colors.lineStrong,
            backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
            borderRadius: t.radius.sm,
          },
        ]}
      >
        <Text variant="body" tone={value ? 'default' : 'tertiary'} style={{ flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Icon name={icon} size={18} color={t.colors.textTertiary} />
      </Pressable>
      {error && (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

export function CountyPicker({
  visible,
  onClose,
  value,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  value?: string | null;
  onSelect: (county: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...COUNTIES].sort().filter((c) => !s || c.toLowerCase().includes(s));
  }, [q]);
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('setup.county')} scroll={false}>
      <SearchField value={q} onChangeText={setQ} placeholder={tr('common.search')} autoFocus />
      <FlatList
        data={list}
        keyExtractor={(c) => c}
        style={{ maxHeight: 420 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const selected = item === value;
          return (
            <Pressable
              onPress={() => {
                onSelect(item);
                onClose();
                setQ('');
              }}
              haptics="selection"
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={item}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: selected
                    ? t.colors.primaryTint
                    : pressed
                      ? t.colors.surfaceMuted
                      : 'transparent',
                  borderRadius: t.radius.sm,
                },
              ]}
            >
              <Text variant="body" style={{ flex: 1 }}>
                {item}
              </Text>
              {selected && <Icon name="check" size={18} color={t.colors.primary} weight="bold" />}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

/** DD / MM / YYYY, three short numeric fields. Returns an ISO date or null. */
export function DateOfBirthField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  /** Shown in red under the fields; the hint stays visible above it. */
  error?: string | null;
  value: { d: string; m: string; y: string };
  onChange: (v: { d: string; m: string; y: string }) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="calloutStrong">{label}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TextField
          containerStyle={{ flex: 1 }}
          placeholder={tr('common.dateParts.dayShort')}
          keyboardType="number-pad"
          maxLength={2}
          value={value.d}
          onChangeText={(d) => onChange({ ...value, d: d.replace(/\D/g, '') })}
          accessibilityLabel={tr('common.dateParts.day', { field: label })}
        />
        <TextField
          containerStyle={{ flex: 1 }}
          placeholder={tr('common.dateParts.monthShort')}
          keyboardType="number-pad"
          maxLength={2}
          value={value.m}
          onChangeText={(m) => onChange({ ...value, m: m.replace(/\D/g, '') })}
          accessibilityLabel={tr('common.dateParts.month', { field: label })}
        />
        <TextField
          containerStyle={{ flex: 1.4 }}
          placeholder={tr('common.dateParts.yearShort')}
          keyboardType="number-pad"
          maxLength={4}
          value={value.y}
          onChangeText={(y) => onChange({ ...value, y: y.replace(/\D/g, '') })}
          accessibilityLabel={tr('common.dateParts.year', { field: label })}
        />
      </View>
      {hint && (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      )}
      {error && (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

export const MIN_AGE = 18;
export const MAX_AGE = 100;

/** Whole years between a birth date and today. */
export function ageFrom(iso: string, now = new Date()) {
  const b = new Date(iso);
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) a -= 1;
  return a;
}

/** Why a date of birth cannot be used, or null when it is fine or left empty. */
export function dobProblem(v: { d: string; m: string; y: string }): 'invalid' | 'tooYoung' | 'tooOld' | null {
  const iso = dobToIso(v);
  if (iso === null) return null;
  if (iso === 'invalid') return 'invalid';
  const a = ageFrom(iso);
  if (a < MIN_AGE) return 'tooYoung';
  if (a > MAX_AGE) return 'tooOld';
  return null;
}

export function dobToIso(v: { d: string; m: string; y: string }): string | null | 'invalid' {
  if (!v.d && !v.m && !v.y) return null;
  const d = Number(v.d);
  const m = Number(v.m);
  const y = Number(v.y);
  const date = new Date(Date.UTC(y, m - 1, d));
  const now = new Date();
  if (!d || !m || y < 1900 || date.getUTCMonth() !== m - 1 || date > now) return 'invalid';
  return date.toISOString();
}

/** "Use my current location" with permission handling and a clear result line. */
export function LocationButton({
  value,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (v: { lat: number; lng: number }) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setBusy(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError(tr('location.denied'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      onChange({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
    } catch {
      setError(tr('location.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label={value ? tr('setup.locationSet') : tr('setup.useMyLocation')}
        icon={value ? 'checkCircle' : 'navigate'}
        variant={value ? 'secondary' : 'outline'}
        size="md"
        onPress={locate}
        loading={busy}
      />
      {value && (
        <Text variant="caption" tone="tertiary" numeric align="center">
          {value.lat.toFixed(4)}, {value.lng.toFixed(4)}
        </Text>
      )}
      {error && (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {!value && (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} color={t.colors.textTertiary} />
          <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
            {tr('location.why')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  select: {
    minHeight: 50,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12 },
});
