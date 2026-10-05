import { Image, type ImageSource } from 'expo-image';
import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import i18n from '../i18n';
import { useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

/** Quantity stepper from the mockup ("- 1 +"). */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 1_000_000,
  step = 1,
  unit,
  size = 'md',
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const t = useTheme();
  const h = { sm: 34, md: 42, lg: 50 }[size];
  const name = label ?? i18n.t('common.quantity');
  const btn = (icon: IconName, next: number, disabled: boolean, a11y: string) => (
    <Pressable
      onPress={() => onChange(Math.min(max, Math.max(min, Number(next.toFixed(2)))))}
      disabled={disabled}
      haptics="selection"
      accessibilityLabel={a11y}
      hitSlop={6}
      focusRadius={h / 2}
      style={({ pressed }) => [
        styles.stepBtn,
        {
          width: h,
          height: h,
          borderRadius: h / 2,
          backgroundColor: pressed ? t.colors.primaryTint : 'transparent',
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 18} color={t.colors.text} weight="bold" />
    </Pressable>
  );
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={name}
      accessibilityValue={{ text: `${value}${unit ? ` ${unit}` : ''}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + step));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - step));
      }}
      style={[
        styles.stepper,
        { borderColor: t.colors.lineStrong, borderRadius: t.radius.pill, height: h + 2 },
      ]}
    >
      {btn('minus', value - step, value <= min, i18n.t('common.decrease', { name }))}
      <Text
        variant={size === 'lg' ? 'title3' : 'bodyStrong'}
        numeric
        style={{ minWidth: 36, textAlign: 'center' }}
      >
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </Text>
      {btn('plus', value + step, value >= max, i18n.t('common.increase', { name }))}
    </View>
  );
}

/** Filter chip from the mockup ("All", "Leafy Greens"). */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  count?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      haptics="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      focusRadius={999}
      style={({ pressed, hovered }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? t.colors.primary
            : pressed || hovered
              ? t.colors.surfaceMuted
              : t.colors.surface,
          borderColor: selected ? t.colors.primary : t.colors.lineStrong,
        },
      ]}
    >
      {icon && (
        <Icon name={icon} size={16} color={selected ? t.colors.textOnBrand : t.colors.textSecondary} />
      )}
      <Text
        variant="calloutStrong"
        style={{ color: selected ? t.colors.textOnBrand : t.colors.textSecondary }}
      >
        {label}
      </Text>
      {count !== undefined && (
        <Text
          variant="caption"
          numeric
          style={{ color: selected ? t.colors.textOnBrandMuted : t.colors.textTertiary }}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
}

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

/** Status pill. Always text plus color, never color alone. */
export function Pill({
  label,
  tone = 'neutral',
  icon,
  size = 'md',
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  size?: 'sm' | 'md';
}) {
  const t = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: t.colors.surfaceMuted, fg: t.colors.textSecondary },
    brand: { bg: t.colors.primaryTint, fg: t.colors.primary },
    success: { bg: t.colors.successTint, fg: t.colors.success },
    warning: { bg: t.colors.warningTint, fg: t.colors.warning },
    danger: { bg: t.colors.dangerTint, fg: t.colors.danger },
    info: { bg: t.colors.infoTint, fg: t.colors.info },
  };
  const c = map[tone];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: c.bg,
          paddingVertical: size === 'sm' ? 2 : 4,
          paddingHorizontal: size === 'sm' ? 8 : 10,
        },
      ]}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} color={c.fg} weight="bold" />}
      <Text variant={size === 'sm' ? 'micro' : 'caption'} style={{ color: c.fg }} weight="semibold">
        {label}
      </Text>
    </View>
  );
}

/** Tag with a small icon, as in the mockup product detail ("Fresh", "Organic", "Local"). */
/** Small trust marker. `badge` shows the embossed seal art instead of the glyph. */
export function Tag({
  label,
  icon,
  badge,
}: {
  label: string;
  icon: IconName;
  badge?: ImageSource | number | null;
}) {
  const t = useTheme();
  return (
    <View style={styles.tag}>
      {badge ? (
        <Image
          source={badge}
          style={{ width: 26, height: 26 }}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Icon name={icon} size={18} color={t.colors.primary} weight="fill" />
      )}
      <Text variant="callout" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

export function Avatar({
  uri,
  name,
  size = 44,
  ring,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
  ring?: boolean;
}) {
  const t = useTheme();
  const initials = (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name ? `${name}` : 'Profile photo'}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.colors.primaryTintStrong,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: ring ? 2 : 0,
        borderColor: t.colors.surface,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" transition={150} />
      ) : (
        <Text variant={size > 56 ? 'title2' : 'bodyStrong'} tone="brand">
          {initials || '?'}
        </Text>
      )}
    </View>
  );
}

/** Surface card: white, 14 radius, soft offset shadow (mockup stat cards). */
export function Card({
  children,
  style,
  onPress,
  padded = true,
  accessibilityLabel,
  elevated = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
  accessibilityLabel?: string;
  elevated?: boolean;
}) {
  const t = useTheme();
  const base = [
    {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.md,
      padding: padded ? t.space[4] : 0,
      borderWidth: t.scheme === 'dark' || !elevated ? 1 : 0,
      borderColor: t.colors.line,
    },
    elevated && t.scheme === 'light' && t.elevation.card,
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      focusRadius={t.radius.md}
      haptics="selection"
      style={({ pressed, hovered }) => [
        base,
        (pressed || hovered) && { backgroundColor: t.colors.surfaceMuted },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0, vertical }: { inset?: number; vertical?: boolean }) {
  const t = useTheme();
  if (vertical)
    return (
      <View
        style={{ width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', backgroundColor: t.colors.line }}
      />
    );
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.colors.line, marginLeft: inset }}
    />
  );
}

/** Radio row, used for payment methods (mockup checkout). */
export function RadioRow({
  label,
  description,
  selected,
  onPress,
  trailing,
  disabled,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      haptics="selection"
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={label}
      focusRadius={t.radius.sm}
      style={({ pressed }) => [
        styles.radioRow,
        {
          borderColor: selected ? t.colors.primary : t.colors.line,
          backgroundColor: selected
            ? t.colors.primaryTint
            : pressed
              ? t.colors.surfaceMuted
              : t.colors.surface,
          borderRadius: t.radius.sm,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? t.colors.primary : t.colors.lineStrong }]}>
        {selected && <View style={[styles.radioDot, { backgroundColor: t.colors.primary }]} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        {description && (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      haptics="selection"
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.checkRow}
      focusRadius={6}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: checked ? t.colors.primary : t.colors.surface,
            borderColor: checked ? t.colors.primary : t.colors.lineStrong,
          },
        ]}
      >
        {checked && <Icon name="check" size={14} color="#FFFFFF" weight="bold" />}
      </View>
      <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Switch({
  value,
  onChange,
  label,
  description,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      haptics="selection"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={styles.switchRow}
      focusRadius={8}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {description && (
          <Text variant="caption" tone="tertiary">
            {description}
          </Text>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: value ? t.colors.primary : t.colors.lineStrong }]}>
        <View style={[styles.thumb, { transform: [{ translateX: value ? 20 : 0 }] }, t.elevation.card]} />
      </View>
    </Pressable>
  );
}

/** Segmented control for 2 to 4 mutually exclusive views (Active / Past). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.segmented, { backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.pill }]}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            haptics="selection"
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            focusRadius={999}
            style={[
              styles.segment,
              { borderRadius: t.radius.pill, backgroundColor: active ? t.colors.surface : 'transparent' },
              active && t.elevation.card,
            ]}
          >
            <Text variant="calloutStrong" tone={active ? 'default' : 'secondary'}>
              {o.label}
            </Text>
            {o.count !== undefined && o.count > 0 && (
              <View
                style={[
                  styles.segCount,
                  { backgroundColor: active ? t.colors.primary : t.colors.lineStrong },
                ]}
              >
                <Text variant="micro" numeric style={{ color: active ? '#FFFFFF' : t.colors.textSecondary }}>
                  {o.count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 1,
    alignSelf: 'flex-start',
  },
  stepBtn: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, alignSelf: 'flex-start' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1.5,
    minHeight: 56,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  track: { width: 48, height: 28, borderRadius: 14, padding: 2, justifyContent: 'center' },
  thumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  segmented: { flexDirection: 'row', padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  segCount: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
