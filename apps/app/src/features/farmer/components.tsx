import type { ListingDto } from '@farmgo/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { dateShort, kes, produceName, qty, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Pill, type Tone } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';

type OwnListing = Pick<
  ListingDto,
  | 'id'
  | 'status'
  | 'quantity'
  | 'quantityLeft'
  | 'pricePerUnit'
  | 'availableFrom'
  | 'availableTo'
  | 'photoUrls'
  | 'harvestReady'
  | 'grade'
> & { produce: ListingDto['produce'] };

/** Listing status in farmer words. */
export function listingStatusView(l: Pick<ListingDto, 'status' | 'availableFrom' | 'availableTo'>): {
  labelKey: string;
  tone: Tone;
} {
  const now = Date.now();
  if (l.status === 'CANCELLED') return { labelKey: 'farmer.listingStatus.closed', tone: 'neutral' };
  if (l.status === 'EXPIRED' || new Date(l.availableTo).getTime() < now - 86_400_000)
    return { labelKey: 'farmer.listingStatus.ended', tone: 'neutral' };
  if (l.status === 'FULLY_MATCHED') return { labelKey: 'farmer.listingStatus.soldOut', tone: 'success' };
  if (l.status === 'DRAFT') return { labelKey: 'farmer.listingStatus.paused', tone: 'warning' };
  if (new Date(l.availableFrom).getTime() > now)
    return { labelKey: 'farmer.listingStatus.upcoming', tone: 'info' };
  if (l.status === 'PARTIALLY_MATCHED') return { labelKey: 'farmer.listingStatus.selling', tone: 'brand' };
  return { labelKey: 'farmer.listingStatus.live', tone: 'brand' };
}

/** Mockup 9 "My Products" row: photo, name and unit, price, how much is left. */
export function ListingRow({
  listing,
  onPress,
  selected,
}: {
  listing: OwnListing;
  onPress: () => void;
  selected?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const s = listingStatusView(listing);
  const left = Number(listing.quantityLeft);
  const unit = unitLabel(listing.produce.unit, left);
  const name = produceName(listing.produce);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${name}, ${kes(listing.pricePerUnit)} ${tr('common.perUnit', { unit: unitLabel(listing.produce.unit) })}, ${tr('farmer.left', { qty: qty(left), unit })}, ${tr(s.labelKey)}`}
      accessibilityState={{ selected: !!selected }}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.row,
        {
          borderRadius: t.radius.md,
          borderColor: selected ? t.colors.primary : t.colors.line,
          backgroundColor: selected
            ? t.colors.primaryTint
            : pressed || hovered
              ? t.colors.surfaceMuted
              : t.colors.surface,
        },
      ]}
    >
      <ProduceImage
        uri={listing.photoUrls[0] ?? listing.produce.imageUrl}
        category={listing.produce.category}
        produce={listing.produce}
        size={56}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name} ({unitLabel(listing.produce.unit)})
        </Text>
        <Text variant="callout" tone="secondary" numeric>
          {kes(listing.pricePerUnit)}
          {listing.grade ? ` · ${tr('farmer.gradeShort', { grade: listing.grade })}` : ''}
        </Text>
        <Text variant="caption" tone="tertiary">
          {tr('farmer.dateRange', {
            from: dateShort(listing.availableFrom),
            to: dateShort(listing.availableTo),
          })}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text variant="caption" tone={left > 0 ? 'leaf' : 'tertiary'} numeric style={{ fontWeight: '600' }}>
          {tr('farmer.available', { qty: qty(left), unit })}
        </Text>
        <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
      </View>
    </Pressable>
  );
}

/** Stat tile from the mockup dashboards (label on top, big number below). */
export function StatTile({
  label,
  value,
  icon,
  hint,
  onPress,
  trailing,
}: {
  label: string;
  value: string | null;
  icon?: IconName;
  hint?: string;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const t = useTheme();
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon && <Icon name={icon} size={16} color={t.colors.textTertiary} />}
        <Text variant="caption" tone="secondary" numberOfLines={2} style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {value === null ? (
          <View style={{ height: 30, width: 70, borderRadius: 6, backgroundColor: t.colors.skeleton }} />
        ) : (
          <Text variant="statNumber" numeric numberOfLines={1} adjustsFontSizeToFit>
            {value}
          </Text>
        )}
        {trailing}
      </View>
      {hint && (
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {hint}
        </Text>
      )}
    </>
  );
  const box = [
    styles.tile,
    { backgroundColor: t.colors.surface, borderColor: t.colors.line, borderRadius: t.radius.md },
  ];
  if (!onPress) return <View style={box}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? ''}`}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        box,
        (pressed || hovered) && { backgroundColor: t.colors.surfaceMuted },
      ]}
    >
      {body}
    </Pressable>
  );
}

/** Small step indicator for multi-step flows: "Step 2 of 5" and a segmented bar. */
export function StepBar({ step, total, label }: { step: number; total: number; label: string }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View
      style={{ gap: 8 }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: step + 1 }}
    >
      <Text variant="caption" tone="secondary">
        {tr('farmer.stepOf', { n: step + 1, total })} · {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => `step-${i}`).map((k, i) => (
          <View
            key={k}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= step ? t.colors.primary : t.colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
  tile: { flex: 1, minWidth: 140, padding: 14, gap: 6, borderWidth: 1 },
});
