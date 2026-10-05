import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/** Tracks connectivity, tells React Query, and shows a slim bar while offline. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let mounted = true;
    const apply = (connected: boolean) => {
      if (!mounted) return;
      setOnline(connected);
      onlineManager.setOnline(connected);
    };
    void Network.getNetworkStateAsync()
      .then((s) => apply(s.isConnected !== false && s.isInternetReachable !== false))
      .catch(() => undefined);
    const sub = Network.addNetworkStateListener((s) =>
      apply(s.isConnected !== false && s.isInternetReachable !== false),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  if (online) return null;
  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(160)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: t.colors.band, paddingTop: insets.top + 6 }]}
    >
      <View style={styles.row}>
        <Icon name="wifiOff" size={16} color="#F2C66D" weight="bold" />
        <Text variant="caption" style={{ color: '#FFFFFF', flex: 1 }} numberOfLines={2}>
          {tr('common.offlineTitle')}. {tr('common.offlineBody')}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
