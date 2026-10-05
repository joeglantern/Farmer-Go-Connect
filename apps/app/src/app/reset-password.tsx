import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { auth } from '../data/session';
import { humanError } from '../lib/errors';
import { Button } from '../ui/Button';
import { Banner } from '../ui/overlays/Banner';
import { useToast } from '../ui/overlays/Toast';
import { Header, Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

/** Landing page for the reset link in the email (`/reset-password?token=...`). */
export default function ResetPassword() {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const { token, error: linkError } = useLocalSearchParams<{ token?: string; error?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalid = !token || !!linkError;

  const submit = async () => {
    if (password.length < 8) return setError(tr('auth.errors.password'));
    if (password !== confirm) return setError(tr('reset.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(token!, password);
      toast.success(tr('reset.done'));
      router.replace({ pathname: '/sign-in', params: { method: 'email' } });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      maxWidth={480}
      header={<Header onBack={() => router.replace('/sign-in')} />}
      footer={
        invalid ? (
          <Button label={tr('auth.sendLink')} onPress={() => router.replace('/forgot')} />
        ) : (
          <Button label={tr('reset.submit')} onPress={submit} loading={busy} />
        )
      }
    >
      <View style={{ gap: 6, marginBottom: 24 }}>
        <Text variant="title2" accessibilityRole="header">
          {tr('reset.title')}
        </Text>
        <Text variant="callout" tone="secondary">
          {tr('reset.body')}
        </Text>
      </View>
      {invalid ? (
        <Banner tone="warning" message={tr('reset.invalid')} />
      ) : (
        <View style={{ gap: 16 }}>
          {error && <Banner tone="danger" message={error} />}
          <TextField
            label={tr('reset.newPassword')}
            value={password}
            onChangeText={setPassword}
            secureToggle
            autoComplete="new-password"
            textContentType="newPassword"
            icon="lock"
          />
          <TextField
            label={tr('reset.confirm')}
            value={confirm}
            onChangeText={setConfirm}
            secureToggle
            autoComplete="new-password"
            icon="lock"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </View>
      )}
    </Screen>
  );
}
