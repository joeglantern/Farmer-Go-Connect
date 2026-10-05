import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';

/**
 * Keeps everything clear of side cutouts (landscape notch, camera hole) by padding the whole
 * app, then tells descendants the sides are already handled so nothing pads twice.
 */
export function SafeSides({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: t.colors.bg }}
    >
      <SafeAreaInsetsContext.Provider value={{ ...insets, left: 0, right: 0 }}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * Below a bar that already covers the status bar / notch / Dynamic Island, children must not
 * add the top inset again. Wrap them in this when `active`.
 */
export function TopInsetConsumed({ active, children }: { active: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  if (!active) return <>{children}</>;
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{children}</SafeAreaInsetsContext.Provider>
  );
}
