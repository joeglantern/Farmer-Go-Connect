import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from '../lib/api';
import { hrefForLink, linkFromData } from '../lib/deeplink';
import { useSession } from './session';

/** Register this device's Expo push token with the API (POST /v1/devices). */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FarmGo',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#1C6536',
      });
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post('/v1/devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return token;
  } catch {
    // No project id in development builds, or no network: push stays off; in-app still works.
    return null;
  }
}

/**
 * Open the right screen when a push notification is tapped, including the tap that launched
 * the app (B14 deep links). Mount once in the signed-in layout.
 */
export function usePushTaps() {
  const role = useSession((s) => s.me?.user.role);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (data: unknown) => {
      const href = hrefForLink(linkFromData(data), role);
      if (href) router.push(href);
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) open(r.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, [role]);
}
