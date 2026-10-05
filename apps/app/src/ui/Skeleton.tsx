import { useEffect } from 'react';
import { type DimensionValue, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import i18n from '../i18n';
import { useTheme } from '../theme/theme';

/** Loading placeholder with a slow breathing pulse (static when Reduce Motion is on). */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withTiming(0.55, { duration: 900 }), -1, true);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: t.colors.skeleton }, anim, style]}
    />
  );
}

export function SkeletonList({ count = 4, height = 88 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel={i18n.t('common.loading')} accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders that never reorder
        <Skeleton key={i} height={height} radius={14} />
      ))}
    </View>
  );
}
