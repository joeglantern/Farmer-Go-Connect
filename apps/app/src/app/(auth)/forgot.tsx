import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { auth } from '../../data/session';
import { API_URL } from '../../lib/config';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

export default function Forgot() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(tr('auth.errors.email'));
    setBusy(true);
    setError(null);
    try {
      // Better Auth emails a link that lands on the app's reset screen with ?token=.
      const redirectTo =
        typeof window !== 'undefined' && window.location
          ? `${window.location.origin}/reset-password`
          : `${API_URL}/reset-password`;
      await auth.requestPasswordReset(email.trim().toLowerCase(), redirectTo);
      setSent(true);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen
        maxWidth={480}
        header={<Header />}
        footer={
          <Button
            label={tr('auth.backToSignIn')}
            onPress={() => router.replace({ pathname: '/sign-in', params: { method: 'email' } })}
          />
        }
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: t.colors.primaryTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Icon name="mail" size={30} color={t.colors.primary} weight="duotone" />
        </View>
        <Text variant="title2" accessibilityRole="header">
          {tr('auth.linkSent')}
        </Text>
        <Text variant="callout" tone="secondary" style={{ marginTop: 8 }}>
          {tr('auth.linkSentBody', { email: email.trim() })}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      maxWidth={480}
      header={<Header />}
      footer={<Button label={tr('auth.sendLink')} onPress={submit} loading={busy} />}
    >
      <View style={{ gap: 6, marginBottom: 24 }}>
        <Text variant="title2" accessibilityRole="header">
          {tr('auth.forgotTitle')}
        </Text>
        <Text variant="callout" tone="secondary">
          {tr('auth.forgotBody')}
        </Text>
      </View>
      {error && error !== tr('auth.errors.email') && <Banner tone="danger" message={error} />}
      <TextField
        label={tr('auth.emailLabel')}
        placeholder={tr('auth.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        icon="mail"
        autoFocus={Platform.OS === 'web'}
        returnKeyType="send"
        onSubmitEditing={submit}
        error={error === tr('auth.errors.email') ? error : null}
      />
    </Screen>
  );
}
