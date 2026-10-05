import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, type TextInput, View } from 'react-native';
import { auth } from '../../data/session';
import { humanError } from '../../lib/errors';
import { Button } from '../../ui/Button';
import { Logo } from '../../ui/brand/Logo';
import { Segmented } from '../../ui/Controls';
import { LanguageToggle } from '../../ui/LanguageToggle';
import { Banner } from '../../ui/overlays/Banner';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

export default function SignIn() {
  const { t: tr } = useTranslation();
  const params = useLocalSearchParams<{ method?: string }>();
  const [method, setMethod] = useState<'phone' | 'email'>(params.method === 'email' ? 'email' : 'phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Which field the error belongs to, so it shows under that field only (QA APP-014).
  const [errorField, setErrorField] = useState<'email' | 'password' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submitPhone = async () => {
    const normalized = auth.normalizePhone(`0${toLocalDigits(phone)}`);
    if (!normalized) return setFieldError(tr('auth.errors.phone'));
    setFieldError(null);
    setFormError(null);
    setBusy(true);
    try {
      await auth.sendOtp(normalized);
      router.push({ pathname: '/verify', params: { phone: normalized } });
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErrorField('email');
      return setFieldError(tr('auth.errors.email'));
    }
    if (password.length < 8) {
      setErrorField('password');
      return setFieldError(tr('auth.errors.password'));
    }
    setFieldError(null);
    setFormError(null);
    setBusy(true);
    try {
      await auth.signInEmail(email.trim().toLowerCase(), password);
      // The (auth) layout redirects once the session is set.
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      maxWidth={480}
      header={<Header right={<LanguageToggle />} />}
      footer={
        <Button
          label={method === 'phone' ? tr('auth.sendCode') : tr('auth.signIn')}
          onPress={method === 'phone' ? submitPhone : submitEmail}
          loading={busy}
        />
      }
    >
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <Logo size="sm" />
      </View>
      <View style={{ gap: 6, marginBottom: 20 }}>
        <Text variant="title2" accessibilityRole="header">
          {tr('auth.signInTitle')}
        </Text>
        <Text variant="callout" tone="secondary">
          {tr('auth.signInBody')}
        </Text>
      </View>
      <Segmented
        value={method}
        onChange={(v) => {
          setMethod(v);
          setFieldError(null);
          setFormError(null);
        }}
        options={[
          { value: 'phone', label: tr('auth.phoneTab') },
          { value: 'email', label: tr('auth.emailTab') },
        ]}
      />
      <View style={{ gap: 16, marginTop: 20 }}>
        {formError && <Banner tone="danger" message={formError} />}
        {method === 'phone' ? (
          <PhoneField
            label={tr('auth.phoneLabel')}
            placeholder={tr('auth.phonePlaceholder')}
            value={phone}
            onChangeText={(v) => {
              setPhone(v.replace(/[^\d ]/g, ''));
              setFieldError(null);
            }}
            hint={tr('auth.phoneHint')}
            error={fieldError}
            returnKeyType="send"
            onSubmitEditing={submitPhone}
            autoFocus={Platform.OS === 'web'}
          />
        ) : (
          <>
            <TextField
              label={tr('auth.emailLabel')}
              placeholder={tr('auth.emailPlaceholder')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setFieldError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              icon="mail"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              error={errorField === 'email' ? fieldError : null}
            />
            <TextField
              ref={passwordRef}
              label={tr('auth.passwordLabel')}
              placeholder={tr('auth.passwordPlaceholder')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setFieldError(null);
              }}
              secureToggle
              autoComplete="current-password"
              textContentType="password"
              icon="lock"
              returnKeyType="go"
              onSubmitEditing={submitEmail}
              error={errorField === 'password' ? fieldError : null}
            />
            <Pressable
              onPress={() => router.push('/forgot')}
              accessibilityRole="link"
              accessibilityLabel={tr('auth.forgotPassword')}
              style={{ alignSelf: 'flex-end', paddingVertical: 6 }}
              focusRadius={6}
            >
              <Text variant="calloutStrong" tone="brand">
                {tr('auth.forgotPassword')}
              </Text>
            </Pressable>
          </>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          <Text variant="callout" tone="secondary">
            {tr('auth.noAccount')}
          </Text>
          <Pressable
            onPress={() => router.replace('/role')}
            accessibilityRole="link"
            accessibilityLabel={tr('auth.createAccount')}
            focusRadius={6}
            hitSlop={10}
          >
            <Text variant="calloutStrong" tone="brand">
              {tr('auth.createAccount')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
