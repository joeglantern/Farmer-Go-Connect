import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useBadges } from '../../data/badges';
import { usePushTaps } from '../../data/push';
import { useRealtimeConnection } from '../../data/realtime';
import { useSession } from '../../data/session';
import { Rail, Sidebar, TabBar, useShowsTabBar } from '../../nav/Shell';
import { ViewingAsBar } from '../../nav/ViewingAsBar';
import { useSizeClass, useTheme } from '../../theme/theme';
import { OfflineBanner, useOnline } from '../../ui/OfflineBanner';
import { setToastBottomOffset } from '../../ui/overlays/Toast';
import { TopInsetConsumed } from '../../ui/SafeArea';

/**
 * Signed-in shell. Phones: stack of screens with a bottom tab bar on top-level screens.
 * Tablets and unfolded foldables: navigation rail. Desktop: sidebar. The layout follows the
 * live window width, so a foldable switches as it opens.
 */
export default function AppLayout() {
  const t = useTheme();
  const { status, me, impersonating } = useSession();
  const online = useOnline();
  const size = useSizeClass();
  const showTabs = useShowsTabBar();
  const badges = useBadges();
  useRealtimeConnection();
  usePushTaps();

  useEffect(() => {
    setToastBottomOffset(size === 'compact' && showTabs ? t.layout.tabBar : 0);
  }, [size, showTabs, t.layout.tabBar]);

  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (me?.needsOnboarding) return <Redirect href="/setup" />;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      {size === 'expanded' && <Sidebar badges={badges} />}
      {size === 'medium' && <Rail badges={badges} />}
      <View style={{ flex: 1 }}>
        {/* Each top bar covers the status bar / notch itself; whatever sits below it must not add the inset again. */}
        <ViewingAsBar />
        <TopInsetConsumed active={impersonating}>
          <OfflineBanner />
          <TopInsetConsumed active={!online}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }} />
          </TopInsetConsumed>
        </TopInsetConsumed>
        {size === 'compact' && showTabs && <TabBar badges={badges} />}
      </View>
    </View>
  );
}
