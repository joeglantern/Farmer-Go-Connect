import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Header } from '../ui/Screen';
import { EmptyState } from '../ui/States';

/** Any unknown or stale link lands here, in the app's own look and language. */
export default function NotFound() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          art="noResults"
          title={tr('missingPage.title')}
          body={tr('missingPage.body')}
          action={{ label: tr('missingPage.home'), icon: 'home', onPress: () => router.replace('/') }}
        />
      </View>
    </View>
  );
}
