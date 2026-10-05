import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { useTheme } from '../theme/theme';
import { fonts, type TypeRole } from '../theme/tokens';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'leaf'
  | 'onBrand'
  | 'onBrandMuted'
  | 'danger'
  | 'warning'
  | 'info'
  | 'success';

export interface TextProps extends RNTextProps {
  variant?: TypeRole;
  tone?: TextTone;
  /** Use tabular figures (prices, stats, codes) so digits line up. */
  numeric?: boolean;
  align?: 'left' | 'center' | 'right';
  weight?: keyof typeof fonts;
}

export function Text({
  variant = 'body',
  tone = 'default',
  numeric,
  align,
  weight,
  style,
  ...rest
}: TextProps) {
  const t = useTheme();
  const role = t.type[variant];
  const color = {
    default: t.colors.text,
    secondary: t.colors.textSecondary,
    tertiary: t.colors.textTertiary,
    brand: t.colors.primary,
    leaf: t.colors.leaf,
    onBrand: t.colors.textOnBrand,
    onBrandMuted: t.colors.textOnBrandMuted,
    danger: t.colors.danger,
    warning: t.colors.warning,
    info: t.colors.info,
    success: t.colors.success,
  }[tone];
  return (
    <RNText
      maxFontSizeMultiplier={2}
      style={[
        {
          fontFamily: fonts[weight ?? role.weight],
          fontSize: role.size,
          lineHeight: role.line,
          letterSpacing: 'tracking' in role ? role.tracking : 0,
          color,
          textAlign: align,
        },
        numeric && styles.numeric,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  numeric: { fontVariant: ['tabular-nums'] },
});
