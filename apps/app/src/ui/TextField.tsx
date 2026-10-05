import { forwardRef, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import i18n from '../i18n';
import { useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  prefix?: string;
  suffix?: ReactNode;
  optional?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  /** Show/hide toggle for passwords. */
  secureToggle?: boolean;
}

/**
 * Labeled text input. Label above (mockup "Delivery Address"), hint or error below.
 * The error replaces the hint and is announced to screen readers.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    icon,
    prefix,
    suffix,
    optional,
    containerStyle,
    secureToggle,
    secureTextEntry,
    editable = true,
    ...rest
  },
  ref,
) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.lineStrong;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label && (
        <View style={styles.labelRow}>
          <Text variant="calloutStrong">{label}</Text>
          {optional && (
            <Text variant="caption" tone="tertiary">
              {tr('common.optional')}
            </Text>
          )}
        </View>
      )}
      <View
        style={[
          styles.field,
          {
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            backgroundColor: editable ? t.colors.surface : t.colors.surfaceMuted,
            borderRadius: t.radius.sm,
          },
        ]}
      >
        {icon && <Icon name={icon} size={20} color={t.colors.textTertiary} />}
        {prefix && (
          <Text variant="body" tone="secondary" numeric>
            {prefix}
          </Text>
        )}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={t.colors.textTertiary}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          accessibilityLabel={label ?? rest.placeholder}
          accessibilityHint={error ?? hint}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            styles.input,
            {
              color: t.colors.text,
              fontFamily: t.fonts.regular,
              fontSize: t.type.body.size,
            },
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          ]}
          {...rest}
        />
        {secureToggle && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={10}
            focusRadius={8}
          >
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={t.colors.textTertiary} />
          </Pressable>
        )}
        {suffix}
      </View>
      {(error || hint) && (
        <Text
          variant="caption"
          tone={error ? 'danger' : 'tertiary'}
          accessibilityLiveRegion={error ? 'polite' : undefined}
          accessibilityRole={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </Text>
      )}
    </View>
  );
});

export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  autoFocus,
  style,
  onPress,
}: {
  value?: string;
  onChangeText?: (v: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Render as a tappable fake field that opens the search screen. */
  onPress?: () => void;
}) {
  const t = useTheme();
  const body = (
    <View
      style={[
        styles.search,
        { backgroundColor: t.colors.surface, borderColor: t.colors.line, borderRadius: t.radius.pill },
        style,
      ]}
    >
      <Icon name="search" size={20} color={t.colors.textTertiary} />
      {onPress ? (
        <Text variant="callout" tone="tertiary" style={{ flex: 1 }}>
          {placeholder}
        </Text>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.colors.textTertiary}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          autoFocus={autoFocus}
          accessibilityLabel={placeholder}
          style={[
            styles.input,
            { color: t.colors.text, fontFamily: t.fonts.regular, fontSize: t.type.callout.size },
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          ]}
        />
      )}
      {!!value && !onPress && (
        <Pressable
          onPress={() => onChangeText?.('')}
          accessibilityLabel={i18n.t('common.clearSearch')}
          hitSlop={10}
          focusRadius={10}
        >
          <Icon name="close" size={18} color={t.colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={placeholder}
        accessibilityRole="search"
        focusRadius={999}
      >
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  field: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 12, minHeight: 44 },
  search: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
});
