import { ActivityIndicator, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';
import { type HapticKind, Pressable } from './Pressable';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'onBrand' | 'onPhoto';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  haptics?: HapticKind;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { lg: 54, md: 46, sm: 36 };

/** Pill button from the mockup ("Get Started", "Add to Cart", "Place Order"). */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  iconRight,
  loading,
  disabled,
  fullWidth = true,
  haptics = 'light',
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const palette: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, bgPressed: c.primaryPressed, fg: c.textOnBrand },
    secondary: { bg: c.primaryTint, bgPressed: c.primaryTintStrong, fg: c.primary },
    outline: { bg: 'transparent', bgPressed: c.primaryTint, fg: c.primary, border: c.primary },
    ghost: { bg: 'transparent', bgPressed: c.surfaceMuted, fg: c.primary },
    danger: { bg: c.danger, bgPressed: c.dangerPressed, fg: '#FFFFFF' },
    onBrand: { bg: '#FFFFFF', bgPressed: c.primaryTint, fg: c.band },
    /** Outlined, on an opaque surface so it reads over a photograph. */
    onPhoto: { bg: c.surface, bgPressed: c.primaryTint, fg: c.primary, border: c.primary },
  };
  const p = palette[variant];
  const inactive = disabled || loading;
  const iconSize = size === 'sm' ? 16 : 20;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      haptics={haptics}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!loading, disabled: !!inactive }}
      focusRadius={t.radius.pill}
      hitSlop={size === 'sm' ? 6 : 0}
      style={({ pressed, hovered }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? 14 : 22,
          backgroundColor: pressed || hovered ? p.bgPressed : p.bg,
          borderColor: p.border ?? 'transparent',
          borderWidth: p.border ? 1.5 : 0,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={iconSize} color={p.fg} weight="bold" />}
          <Text variant={size === 'sm' ? 'buttonSmall' : 'button'} style={{ color: p.fg }} numberOfLines={1}>
            {label}
          </Text>
          {iconRight && <Icon name={iconRight} size={iconSize} color={p.fg} weight="bold" />}
        </View>
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  variant?: 'plain' | 'tinted' | 'surface' | 'onBrand' | 'onPhoto';
  size?: number;
  iconSize?: number;
  color?: string;
  badge?: number;
  disabled?: boolean;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Round icon control, 48 dp touch target even when drawn smaller. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'plain',
  size = 44,
  iconSize = 22,
  color,
  badge,
  disabled,
  filled,
  style,
}: IconButtonProps) {
  const t = useTheme();
  const bg = {
    plain: 'transparent',
    tinted: t.colors.primaryTint,
    surface: t.colors.surface,
    onBrand: 'rgba(255,255,255,0.14)',
    onPhoto: 'rgba(255,255,255,0.92)',
  }[variant];
  const fg =
    color ?? (variant === 'onBrand' ? '#FFFFFF' : variant === 'onPhoto' ? t.colors.band : t.colors.text);
  const pad = Math.max(0, (48 - size) / 2);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      haptics="selection"
      hitSlop={pad}
      focusRadius={size / 2}
      style={({ pressed, hovered }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed || hovered ? (variant === 'plain' ? t.colors.surfaceMuted : bg) : bg,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        variant === 'surface' && t.elevation.card,
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={fg} weight={filled ? 'fill' : 'regular'} />
      {!!badge && badge > 0 && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: t.colors.danger,
              borderColor: variant === 'onBrand' ? t.colors.band : t.colors.surface,
            },
          ]}
        >
          <Text variant="micro" style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 12 }} numeric>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
