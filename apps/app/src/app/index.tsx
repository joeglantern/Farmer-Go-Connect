import { Redirect } from 'expo-router';
import { useSession } from '../data/session';

/** Entry: route by session state. The native splash covers the boot. */
export default function Index() {
  const { status, me } = useSession();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (!me) return <Redirect href="/home" />; // signed in but offline at launch: show cached home
  return <Redirect href={me.needsOnboarding ? '/setup' : '/home'} />;
}
