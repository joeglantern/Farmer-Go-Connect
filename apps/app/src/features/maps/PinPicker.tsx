import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { LocationButton } from '../../ui/Pickers';
import { Text } from '../../ui/Text';
import LeafletMap, { type MarkerKind } from './LeafletMap';

type Point = { lat: number; lng: number };

/** Same precision as the GPS path in LocationButton (6 decimals, about 10 cm). */
const round = (n: number) => Number(n.toFixed(6));

/**
 * Location picker: tap the map to drop a pin, or use the current location as a shortcut.
 * Used by profile setup (farm, business and home addresses).
 */
export function PinPicker({
  label,
  hint,
  value,
  onChange,
  kind = 'pin',
  markerLabel,
}: {
  label: string;
  hint: string;
  value: Point | null;
  onChange: (v: Point | null) => void;
  kind?: MarkerKind;
  markerLabel?: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ gap: 8 }}>
      <Text variant="calloutStrong">{label}</Text>
      <Text variant="caption" tone="secondary">
        {hint}
      </Text>
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line }}>
        <LeafletMap
          markers={
            value ? [{ id: 'pin', lat: value.lat, lng: value.lng, kind, label: markerLabel ?? label }] : []
          }
          pickable
          onPick={(lat, lng) => onChange({ lat: round(lat), lng: round(lng) })}
          dark={t.scheme === 'dark'}
          height={220}
          zoom={value ? 15 : 7}
          center={value ? [value.lat, value.lng] : [-0.4, 37.2]}
          dom={{ scrollEnabled: false, matchContents: true }}
        />
      </View>
      <LocationButton value={value} onChange={onChange} />
      {value && (
        <Button
          label={tr('common.removePin')}
          icon="close"
          variant="ghost"
          size="sm"
          onPress={() => onChange(null)}
        />
      )}
    </View>
  );
}
