import * as Haptics from 'expo-haptics';
import { forwardRef, useState } from 'react';
import {
  Platform,
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/theme';

export type HapticKind = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error' | 'none';

export function haptic(kind: HapticKind) {
  if (Platform.OS === 'web' || kind === 'none') return;
  switch (kind) {
    case 'selection':
      void Haptics.selectionAsync();
      break;
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'success':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
}

export interface PressableProps extends Omit<RNPressableProps, 'style'> {
  style?:
    | StyleProp<ViewStyle>
    | ((state: { pressed: boolean; hovered: boolean; focused: boolean }) => StyleProp<ViewStyle>);
  haptics?: HapticKind;
  /** Draw the keyboard focus ring (web and hardware keyboards). */
  focusRing?: boolean;
  focusRadius?: number;
}

/**
 * The only pressable in the app. Adds hover and keyboard-focus state on web, the focus
 * ring, and haptics on phones. Always pass accessibilityLabel when there is no text child.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { style, haptics = 'none', onPress, focusRing = true, focusRadius, disabled, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <RNPressable
      ref={ref}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      disabled={disabled}
      onPress={(e) => {
        haptic(haptics);
        onPress?.(e);
      }}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      style={(state) => {
        const s = state as { pressed: boolean; hovered?: boolean };
        const base =
          typeof style === 'function' ? style({ pressed: s.pressed, hovered: !!s.hovered, focused }) : style;
        return [
          base,
          Platform.OS === 'web' &&
            ({ cursor: disabled ? 'not-allowed' : 'pointer', outlineStyle: 'none' } as unknown as ViewStyle),
          focusRing &&
            focused &&
            Platform.OS === 'web' &&
            ({
              outlineStyle: 'solid',
              outlineWidth: 2,
              outlineColor: t.colors.focus,
              outlineOffset: 2,
              borderRadius: focusRadius,
            } as ViewStyle),
        ];
      }}
      {...rest}
    />
  );
});
