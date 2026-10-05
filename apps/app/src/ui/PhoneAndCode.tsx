import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import i18n from '../i18n';
import { useTheme } from '../theme/theme';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { TextField, type TextFieldProps } from './TextField';

/** Kenyan phone input: fixed +254 prefix, accepts 07..., 7..., 254... and spaces. */
/** "712345678" -> "712 345 678", the way the number is read aloud. */
export function groupLocal(digits: string) {
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean).join(' ');
}

/**
 * +254 phone input. As you type, a leading 0 or 254 is dropped (the prefix already says it)
 * and the digits are grouped 712 345 678, so the field always shows the real number.
 */
export function PhoneField(props: Omit<TextFieldProps, 'prefix' | 'keyboardType'>) {
  const { onChangeText, value, ...rest } = props;
  return (
    <TextField
      prefix="+254"
      keyboardType="phone-pad"
      textContentType="telephoneNumber"
      autoComplete="tel"
      maxLength={11}
      {...rest}
      value={value ? groupLocal(toLocalDigits(value)) : value}
      onChangeText={(v) => onChangeText?.(groupLocal(toLocalDigits(v).slice(0, 9)))}
    />
  );
}

/** "0712 345 678" or "712345678" -> "712345678" for display inside the +254 field. */
export function toLocalDigits(input: string) {
  return input.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
}

/**
 * Six code boxes backed by one hidden input, so paste, SMS autofill (iOS oneTimeCode,
 * Android sms-otp) and screen readers all work.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  error,
  length = 6,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  length?: number;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const ref = useRef<TextInput>(null);
  const { t: tr } = useTranslation();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (value.length === length) onComplete?.(value);
  }, [value, length, onComplete]);

  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityLabel={tr('common.codeProgress', { count: value.length, total: length })}
      focusRing={false}
      style={styles.codeRow}
    >
      {Array.from({ length }).map((_, i) => {
        const char = value[i] ?? '';
        const active = focused && (i === value.length || (i === length - 1 && value.length === length));
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are fixed positions 1 to N; the index is their identity.
            key={i}
            style={[
              styles.box,
              {
                borderColor: error
                  ? t.colors.danger
                  : active
                    ? t.colors.primary
                    : char
                      ? t.colors.lineStrong
                      : t.colors.line,
                borderWidth: active || error ? 2 : 1.5,
                backgroundColor: t.colors.surface,
                borderRadius: t.radius.sm,
              },
            ]}
          >
            <Text variant="title2" numeric>
              {char}
            </Text>
            {active && !char && <View style={[styles.caret, { backgroundColor: t.colors.primary }]} />}
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={styles.hidden}
        accessibilityLabel={i18n.t('common.verificationCode')}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  box: { flex: 1, maxWidth: 56, aspectRatio: 0.86, alignItems: 'center', justifyContent: 'center' },
  caret: { position: 'absolute', width: 2, height: 24, borderRadius: 1 },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
