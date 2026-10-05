import * as Notifications from 'expo-notifications';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { registerForPush } from '../data/push';
import { useTheme } from '../theme/theme';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';

/**
 * Our own explanation before the OS permission prompt, so people understand why before
 * they are asked. Skipped on the web.
 */
export default function NotificationsPrompt() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = () => router.replace('/home');

  if (Platform.OS === 'web') return <Redirect href="/home" />;

  const allow = async () => {
    setBusy(true);
    try {
      const res = await Notifications.requestPermissionsAsync();
      if (res.granted) await registerForPush();
    } finally {
      setBusy(false);
      go();
    }
  };

  return (
    <Screen
      maxWidth={480}
      footer={
        <>
          <Button label={tr('notificationsPrompt.allow')} onPress={allow} loading={busy} icon="bell" />
          <Button label={tr('notificationsPrompt.later')} variant="ghost" onPress={go} />
        </>
      }
    >
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 64, gap: 20 }}>
        <View
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: t.colors.primaryTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="bell" size={52} color={t.colors.primary} weight="duotone" />
        </View>
        <Text variant="title1" align="center" accessibilityRole="header">
          {tr('notificationsPrompt.title')}
        </Text>
        <Text variant="body" tone="secondary" align="center" style={{ maxWidth: 340 }}>
          {tr('notificationsPrompt.body')}
        </Text>
      </View>
    </Screen>
  );
}
