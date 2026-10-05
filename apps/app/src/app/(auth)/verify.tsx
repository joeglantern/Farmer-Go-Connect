import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { auth } from '../../data/session';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/overlays/Toast';
import { CodeInput } from '../../ui/PhoneAndCode';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';

const RESEND_SECONDS = 45;

/** "+254712345678" -> "+254 712 345 678" */
const pretty = (p: string) => p.replace(/^\+254(\d{3})(\d{3})(\d{3})$/, '+254 $1 $2 $3');

export default function Verify() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== 6) return setError(tr('auth.errors.code'));
      if (submitted.current === value) return;
      submitted.current = value;
      setBusy(true);
      setError(null);
      try {
        await auth.verifyOtp(phone, value);
        // Redirect handled by the (auth) layout.
      } catch (err) {
        setError(humanError(err));
        setCode('');
        submitted.current = null;
      } finally {
        setBusy(false);
      }
    },
    [phone, tr],
  );

  const resend = async () => {
    try {
      await auth.sendOtp(phone);
      setSeconds(RESEND_SECONDS);
      setError(null);
      toast.success(tr('auth.codeSent', { phone: pretty(phone) }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  if (!phone) return <Redirect href="/sign-in" />;

  return (
    <Screen
      maxWidth={480}
      header={<Header />}
      footer={
        <Button
          label={tr('auth.verify')}
          onPress={() => submit(code)}
          loading={busy}
          disabled={code.length !== 6}
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
        <Icon name="chat" size={30} color={t.colors.primary} weight="duotone" />
      </View>
      <View style={{ gap: 6, marginBottom: 28 }}>
        <Text variant="title2" accessibilityRole="header">
          {tr('auth.verifyTitle')}
        </Text>
        <Text variant="callout" tone="secondary">
          {tr('auth.verifyBody', { phone: pretty(phone) })}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="link"
          accessibilityLabel={tr('auth.changeNumber')}
          style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
          focusRadius={6}
        >
          <Text variant="calloutStrong" tone="brand">
            {tr('auth.changeNumber')}
          </Text>
        </Pressable>
      </View>
      <CodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={submit}
        error={!!error}
      />
      {error && (
        <Text variant="callout" tone="danger" accessibilityRole="alert" style={{ marginTop: 12 }}>
          {error}
        </Text>
      )}
      <View style={{ marginTop: 24, alignItems: 'flex-start' }}>
        {seconds > 0 ? (
          <Text variant="callout" tone="tertiary" numeric>
            {tr('auth.resendIn', { seconds })}
          </Text>
        ) : (
          <Pressable
            onPress={resend}
            accessibilityRole="button"
            accessibilityLabel={tr('auth.resend')}
            style={{ paddingVertical: 6 }}
            focusRadius={6}
          >
            <Text variant="calloutStrong" tone="brand">
              {tr('auth.resend')}
            </Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}
