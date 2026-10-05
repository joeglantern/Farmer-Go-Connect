import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { auth } from '../../data/session';
import { useSignupIntent } from '../../data/signup-intent';
import { humanError } from '../../lib/errors';
import { Button } from '../../ui/Button';
import { Checkbox, Pill } from '../../ui/Controls';
import { LanguageToggle } from '../../ui/LanguageToggle';
import { Banner } from '../../ui/overlays/Banner';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

export default function SignUp() {
  const { t: tr } = useTranslation();
  const params = useLocalSearchParams<{ method?: string }>();
  const role = useSignupIntent((s) => s.role);
  const [method, setMethod] = useState<'phone' | 'email'>(params.method === 'email' ? 'email' : 'phone');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An error clears as soon as its field is edited (QA APP-006).
  const clear = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: null } : e));

  const validate = () => {
    const e: Record<string, string | null> = {};
    if (method === 'email' && name.trim().length < 2) e.name = tr('auth.errors.name');
    if (method === 'phone' && !auth.normalizePhone(`0${toLocalDigits(phone)}`))
      e.phone = tr('auth.errors.phone');
    if (method === 'email' && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = tr('auth.errors.email');
    if (method === 'email' && password.length < 8) e.password = tr('auth.errors.password');
    if (!agree) e.agree = tr('auth.errors.agree');
    setErrors(e);
    return Object.values(e).every((v) => !v);
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setFormError(null);
    try {
      if (method === 'phone') {
        const normalized = auth.normalizePhone(`0${toLocalDigits(phone)}`)!;
        await auth.sendOtp(normalized);
        router.push({ pathname: '/verify', params: { phone: normalized } });
      } else {
        await auth.signUpEmail(name.trim(), email.trim().toLowerCase(), password);
      }
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
          label={method === 'phone' ? tr('auth.sendCode') : tr('auth.signUp')}
          onPress={submit}
          loading={busy}
        />
      }
    >
      <View style={{ gap: 8, marginBottom: 24 }}>
        {role && <Pill label={tr(`role.${role}`)} tone="brand" icon="check" />}
        <Text variant="title2" accessibilityRole="header">
          {tr('auth.signUpTitle')}
        </Text>
        <Text variant="callout" tone="secondary">
          {method === 'email' ? tr('auth.signUpBodyEmail') : tr('auth.signUpBodyPhone')}
        </Text>
      </View>
      <View style={{ gap: 16 }}>
        {formError && <Banner tone="danger" message={formError} />}
        {method === 'email' ? (
          <>
            <TextField
              label={tr('auth.nameLabel')}
              placeholder={tr('auth.namePlaceholder')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                clear('name');
              }}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              error={errors.name}
            />
            <TextField
              label={tr('auth.emailLabel')}
              placeholder={tr('auth.emailPlaceholder')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                clear('email');
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              icon="mail"
              error={errors.email}
            />
            <TextField
              label={tr('auth.passwordLabel')}
              placeholder={tr('auth.passwordPlaceholder')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                clear('password');
              }}
              secureToggle
              autoComplete="new-password"
              textContentType="newPassword"
              icon="lock"
              error={errors.password}
            />
          </>
        ) : (
          <PhoneField
            label={tr('auth.phoneLabel')}
            placeholder={tr('auth.phonePlaceholder')}
            value={phone}
            onChangeText={(v) => {
              setPhone(v.replace(/[^\d ]/g, ''));
              clear('phone');
            }}
            hint={tr('auth.phoneHint')}
            error={errors.phone}
            autoFocus={Platform.OS === 'web'}
          />
        )}
        <View>
          <Checkbox
            checked={agree}
            onChange={(v) => {
              setAgree(v);
              clear('agree');
            }}
            label={tr('auth.agree')}
          />
          {errors.agree && (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              {errors.agree}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => {
            setMethod(method === 'phone' ? 'email' : 'phone');
            setErrors({});
            setFormError(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={method === 'phone' ? tr('auth.emailTab') : tr('auth.phoneTab')}
          style={{ alignSelf: 'center', paddingVertical: 8 }}
          focusRadius={6}
        >
          <Text variant="calloutStrong" tone="brand">
            {method === 'phone'
              ? `${tr('common.or')} ${tr('auth.emailTab').toLowerCase()}`
              : `${tr('common.or')} ${tr('auth.phoneTab').toLowerCase()}`}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
