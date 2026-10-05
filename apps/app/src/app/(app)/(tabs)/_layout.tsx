import { Tabs } from 'expo-router';
import { useTheme } from '../../../theme/theme';

/**
 * Top-level destinations. The tab bar itself is drawn by the (app) shell (TabBar, Rail or
 * Sidebar by window size), so the navigator's own bar is hidden; Tabs keeps each tab's
 * scroll position and state alive when switching.
 */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.colors.bg }, lazy: true }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="sell" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="people" />
      <Tabs.Screen name="money" />
      <Tabs.Screen name="logistics" />
    </Tabs>
  );
}
