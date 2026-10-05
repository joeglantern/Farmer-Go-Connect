import '../i18n';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/figtree';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../data/query';
import { useSession } from '../data/session';
import { restoreLanguage } from '../i18n';
import { ThemeProvider, useTheme } from '../theme/theme';
import { BootScreen } from '../ui/brand/BootScreen';
import { DialogProvider } from '../ui/overlays/Dialog';
import { ToastProvider } from '../ui/overlays/Toast';
import { SafeSides } from '../ui/SafeArea';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Any render crash lands here instead of a blank white screen. */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return <BootScreen error onRetry={() => void retry()} />;
}

function Shell() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <SafeSides>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.colors.bg },
          }}
        />
      </SafeSides>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });
  const boot = useSession((s) => s.boot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([restoreLanguage(), boot()]).finally(() => setReady(true));
  }, [boot]);

  // Hide the native splash as soon as fonts are in; the boot screen covers the session check.
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded || !ready) return <BootScreen />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <DialogProvider>
                <Shell />
              </DialogProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
