import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../data/session';
import { useTheme } from '../../theme/theme';

/** Signed-out stack. A signed-in user is sent to their home or to profile setup. */
export default function AuthLayout() {
  const t = useTheme();
  const { status, me } = useSession();
  if (status === 'signedIn' && me) return <Redirect href={me.needsOnboarding ? '/setup' : '/home'} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }} />;
}
