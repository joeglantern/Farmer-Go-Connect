import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/theme';
import { Banner } from '../../ui/overlays/Banner';
import { Text } from '../../ui/Text';
import { retryLocationSharing, type ShareState } from './useLocationSharing';

/** "Sharing location" pill with a slow pulse, or a banner when the GPS is blocked. */
export function LiveBadge({
  state,
  pill = false,
}: {
  state: ShareState /** Header use: a warning pill instead of the banner. */;
  pill?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce || state !== 'live') return;
    o.value = withRepeat(withTiming(0.3, { duration: 900 }), -1, true);
  }, [o, reduce, state]);
  const dot = useAnimatedStyle(() => ({ opacity: o.value }));

  if (state === 'off') return null;
  if ((state === 'denied' || state === 'error') && pill) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={tr('driver.locationOffTitle')}
        style={[styles.pill, { backgroundColor: t.colors.warningTint, borderRadius: t.radius.pill }]}
      >
        <View style={[styles.dot, { backgroundColor: t.colors.warning }]} />
        <Text variant="caption" style={{ color: t.colors.warning }}>
          {tr('driver.locationOffTitle')}
        </Text>
      </View>
    );
  }
  if (state === 'denied' || state === 'error') {
    return (
      <Banner
        tone="warning"
        icon="location"
        title={tr('driver.locationOffTitle')}
        message={state === 'denied' ? tr('driver.locationDenied') : tr('driver.locationFailed')}
        action={{ label: tr('common.retry'), onPress: retryLocationSharing }}
      />
    );
  }
  const live = state === 'live';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={live ? tr('driver.sharingLive') : tr('driver.sharingStarting')}
      style={[
        styles.pill,
        { backgroundColor: live ? t.colors.successTint : t.colors.surfaceMuted, borderRadius: t.radius.pill },
      ]}
    >
      <Animated.View
        style={[styles.dot, { backgroundColor: live ? t.colors.success : t.colors.textTertiary }, dot]}
      />
      <Text variant="caption" style={{ color: live ? t.colors.success : t.colors.textSecondary }}>
        {live ? tr('driver.sharingLive') : tr('driver.sharingStarting')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
