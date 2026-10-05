import type { OnboardHouseholdInput } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';
import { images } from '../assets/registry';
import { useSession } from '../data/session';
import { type SignupRole, useSignupIntent } from '../data/signup-intent';
import { PinPicker } from '../features/maps/PinPicker';
import { api } from '../lib/api';
import { humanError } from '../lib/errors';
import { useTheme } from '../theme/theme';
import { Button } from '../ui/Button';
import { Checkbox, Chip, Pill } from '../ui/Controls';
import { Icon, type IconName } from '../ui/Icon';
import { Banner } from '../ui/overlays/Banner';
import { PhoneField, toLocalDigits } from '../ui/PhoneAndCode';
import { CountyPicker, DateOfBirthField, dobProblem, dobToIso, MIN_AGE, SelectField } from '../ui/Pickers';
import { Pressable } from '../ui/Pressable';
import { Header, Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

type Gender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';
type BuyerCategory = 'HOTEL' | 'RESTAURANT' | 'GUESTHOUSE' | 'INSTITUTION' | 'CATERER' | 'OTHER';
type LatLng = { lat: number; lng: number } | null;

const ROLE_ICONS: Record<SignupRole, IconName> = {
  hotel: 'building',
  farmer: 'plant',
  youth: 'sprout',
  household: 'house',
};

export default function Setup() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { status, me, refreshMe } = useSession();
  const { role: intent, setRole, restore } = useSignupIntent();
  const [role, setLocalRole] = useState<SignupRole | null>(intent);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [countyOpen, setCountyOpen] = useState<'person' | 'farm' | null>(null);

  // Shared
  const [name, setName] = useState('');
  const [county, setCounty] = useState<string | null>(null);
  const [town, setTown] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<LatLng>(null);
  // Farmer
  const [gender, setGender] = useState<Gender>('UNDISCLOSED');
  const [dob, setDob] = useState({ d: '', m: '', y: '' });
  const [mpesa, setMpesa] = useState('');
  const [farmName, setFarmName] = useState('');
  const [farmCounty, setFarmCounty] = useState<string | null>(null);
  const [acreage, setAcreage] = useState('');
  const [organic, setOrganic] = useState(false);
  // Business
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState<BuyerCategory>('HOTEL');
  const [businessPhone, setBusinessPhone] = useState('');
  const [kraPin, setKraPin] = useState('');

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (intent && !role) setLocalRole(intent);
  }, [intent, role]);

  useEffect(() => {
    if (!me) return;
    if (me.user.name && !/^\+?\d+$/.test(me.user.name)) setName((n) => n || me.user.name);
    if (me.user.phoneNumber) setMpesa((m) => m || toLocalDigits(me.user.phoneNumber!));
  }, [me]);

  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (me && !me.needsOnboarding) return <Redirect href="/home" />;

  const totalSteps = role === 'farmer' ? 2 : 1;

  const need = (cond: boolean, key: string, msg: string, acc: Record<string, string>) => {
    if (!cond) acc[key] = msg;
  };

  const validateStep = (): boolean => {
    const e: Record<string, string> = {};
    if (role === 'farmer' && step === 1) {
      need(name.trim().length >= 2, 'name', tr('auth.errors.name'), e);
      need(!!county, 'county', tr('setup.countyPlaceholder'), e);
      need(!!normalizeKenyanPhone(`0${toLocalDigits(mpesa)}`), 'mpesa', tr('auth.errors.phone'), e);
      const dobErr = dobProblem(dob);
      if (dobErr)
        e.dob = tr(
          dobErr === 'invalid'
            ? 'setup.dobInvalid'
            : dobErr === 'tooYoung'
              ? 'setup.dobTooYoung'
              : 'setup.dobTooOld',
          { min: MIN_AGE },
        );
    }
    if (role === 'farmer' && step === 2) {
      need(farmName.trim().length >= 2, 'farmName', tr('setup.farmNameRequired'), e);
    }
    if (role === 'hotel') {
      need(businessName.trim().length >= 2, 'businessName', tr('setup.businessNameRequired'), e);
      need(!!county, 'county', tr('setup.countyPlaceholder'), e);
      if (businessPhone && !normalizeKenyanPhone(`0${toLocalDigits(businessPhone)}`))
        e.businessPhone = tr('auth.errors.phone');
    }
    if (role === 'household') {
      need(name.trim().length >= 2, 'name', tr('auth.errors.name'), e);
      need(!!county, 'county', tr('setup.countyPlaceholder'), e);
      need(address.trim().length >= 4, 'address', tr('setup.addressRequired'), e);
    }
    if (role === 'youth') {
      need(businessName.trim().length >= 2, 'businessName', tr('setup.businessNameRequired'), e);
      need(!!county, 'county', tr('setup.countyPlaceholder'), e);
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const phoneOrUndefined = (v: string) =>
    v ? (normalizeKenyanPhone(`0${toLocalDigits(v)}`) ?? undefined) : undefined;

  const submit = async () => {
    if (!validateStep()) return;
    if (role === 'farmer' && step === 1) {
      setFarmCounty((c) => c ?? county);
      setStep(2);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (role === 'farmer') {
        const iso = dobToIso(dob);
        await api.post('/v1/onboarding/farmer', {
          name: name.trim(),
          county,
          gender,
          dateOfBirth: iso && iso !== 'invalid' ? iso : undefined,
          mpesaNumber: phoneOrUndefined(mpesa),
          farm: {
            name: farmName.trim(),
            county: farmCounty ?? county,
            ...(point ?? {}),
            ...(acreage ? { acreage: Number(acreage) } : {}),
            isOrganic: organic,
          },
        });
      } else if (role === 'hotel') {
        await api.post('/v1/onboarding/buyer', {
          businessName: businessName.trim(),
          buyerCategory: category,
          county,
          town: town.trim() || undefined,
          address: address.trim() || undefined,
          ...(point ?? {}),
          phone: phoneOrUndefined(businessPhone),
          kraPin: kraPin.trim() || undefined,
        });
      } else if (role === 'household') {
        const body: OnboardHouseholdInput = {
          name: name.trim(),
          county: county as OnboardHouseholdInput['county'],
          town: town.trim() || undefined,
          address: address.trim() || undefined,
          ...(point ?? {}),
        };
        await api.post('/v1/onboarding/household', body);
      } else if (role === 'youth') {
        await api.post('/v1/onboarding/supplier', {
          businessName: businessName.trim(),
          county,
          town: town.trim() || undefined,
          address: address.trim() || undefined,
          ...(point ?? {}),
          phone: phoneOrUndefined(businessPhone),
        });
      }
      await refreshMe();
      setRole(null);
      router.replace('/notifications-prompt');
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  // No role chosen yet (e.g. signed in on a new device): ask here.
  if (!role) {
    return (
      <Screen maxWidth={560} header={<Header back={false} />}>
        <Text variant="title2" accessibilityRole="header">
          {tr('role.title')}
        </Text>
        <Text variant="callout" tone="secondary" style={{ marginTop: 6, marginBottom: 20 }}>
          {tr('setup.pickRole')}
        </Text>
        <View style={{ gap: 12 }}>
          {(['hotel', 'farmer', 'youth', 'household'] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setLocalRole(r)}
              haptics="selection"
              accessibilityLabel={tr(`role.${r}`)}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  padding: 14,
                  borderRadius: t.radius.md,
                  borderWidth: 1.5,
                  borderColor: t.colors.line,
                  backgroundColor: pressed ? t.colors.primaryTint : t.colors.surface,
                },
              ]}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 16,
                  backgroundColor: t.colors.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {images.roles[r] ? (
                  <Image source={images.roles[r]} style={{ width: 54, height: 54 }} contentFit="contain" />
                ) : (
                  <Icon name={ROLE_ICONS[r]} size={24} color={t.colors.primary} weight="duotone" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline">{tr(`role.${r}`)}</Text>
                <Text variant="caption" tone="secondary">
                  {tr(`role.${r}Body`)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Screen>
    );
  }

  const title =
    role === 'farmer'
      ? step === 1
        ? tr('setup.farmerTitle')
        : tr('setup.farmTitle')
      : role === 'hotel'
        ? tr('setup.businessTitle')
        : role === 'household'
          ? tr('setup.householdTitle')
          : tr('setup.supplierTitle');
  const body =
    role === 'farmer'
      ? step === 1
        ? tr('setup.farmerBody')
        : tr('setup.farmBody')
      : role === 'hotel'
        ? tr('setup.businessBody')
        : role === 'household'
          ? tr('setup.householdBody')
          : tr('setup.supplierBody');

  const isLast = step === totalSteps;

  return (
    <Screen
      maxWidth={560}
      header={
        <Header
          back={step > 1}
          onBack={() => setStep((s) => s - 1)}
          right={<Pill label={tr('setup.step', { n: step, total: totalSteps })} />}
        />
      }
      footer={
        <Button label={isLast ? tr('setup.finish') : tr('common.continue')} onPress={submit} loading={busy} />
      }
    >
      <Animated.View
        key={`${role}-${step}`}
        entering={FadeIn.duration(260).easing(Easing.bezier(0.16, 1, 0.3, 1))}
        style={{ gap: 18 }}
      >
        <View style={{ gap: 6 }}>
          <Pill label={tr(`role.${role}`)} tone="brand" icon={ROLE_ICONS[role]} />
          <Text variant="title2" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="callout" tone="secondary">
            {body}
          </Text>
        </View>

        {formError && <Banner tone="danger" message={formError} />}

        {role === 'farmer' && step === 1 && (
          <>
            <TextField
              label={tr('auth.nameLabel')}
              placeholder={tr('auth.namePlaceholder')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              error={errors.name}
            />
            <SelectField
              label={tr('setup.county')}
              value={county}
              placeholder={tr('setup.countyPlaceholder')}
              onPress={() => setCountyOpen('person')}
              error={errors.county}
            />
            <PhoneField
              label={tr('setup.mpesa')}
              placeholder={tr('auth.phonePlaceholder')}
              value={mpesa}
              onChangeText={(v) => setMpesa(v.replace(/[^\d ]/g, ''))}
              hint={tr('setup.mpesaHint')}
              error={errors.mpesa}
            />
            <View style={{ gap: 8 }}>
              <Text variant="calloutStrong">
                {tr('setup.gender')}{' '}
                <Text variant="caption" tone="tertiary">
                  {tr('common.optional')}
                </Text>
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(
                  [
                    ['FEMALE', tr('setup.female')],
                    ['MALE', tr('setup.male')],
                    ['OTHER', tr('setup.other')],
                    ['UNDISCLOSED', tr('setup.preferNot')],
                  ] as const
                ).map(([v, l]) => (
                  <Chip key={v} label={l} selected={gender === v} onPress={() => setGender(v)} />
                ))}
              </View>
            </View>
            <DateOfBirthField
              label={tr('setup.dob')}
              hint={tr('setup.dobHint')}
              error={errors.dob}
              value={dob}
              onChange={(v) => {
                setDob(v);
                if (errors.dob) setErrors(({ dob: _d, ...rest }) => rest);
              }}
            />
          </>
        )}

        {role === 'farmer' && step === 2 && (
          <>
            <TextField
              label={tr('setup.farmName')}
              placeholder={tr('setup.farmNamePlaceholder')}
              value={farmName}
              onChangeText={setFarmName}
              autoCapitalize="words"
              error={errors.farmName}
            />
            <SelectField
              label={tr('setup.county')}
              value={farmCounty ?? county}
              placeholder={tr('setup.countyPlaceholder')}
              onPress={() => setCountyOpen('farm')}
            />
            <TextField
              label={tr('setup.acreage')}
              optional
              placeholder="2.5"
              value={acreage}
              onChangeText={(v) => setAcreage(v.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
            />
            <Checkbox checked={organic} onChange={setOrganic} label={tr('setup.organic')} />
            <PinPicker
              label={tr('setup.pinLocation')}
              hint={tr('setup.pinHintFarm')}
              value={point}
              onChange={setPoint}
              kind="farm"
            />
          </>
        )}

        {role === 'hotel' && (
          <>
            <TextField
              label={tr('setup.businessName')}
              placeholder={tr('setup.businessNamePlaceholder')}
              value={businessName}
              onChangeText={setBusinessName}
              autoCapitalize="words"
              error={errors.businessName}
            />
            <View style={{ gap: 8 }}>
              <Text variant="calloutStrong">{tr('setup.category')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['HOTEL', 'RESTAURANT', 'GUESTHOUSE', 'INSTITUTION', 'CATERER', 'OTHER'] as const).map(
                  (c) => (
                    <Chip
                      key={c}
                      label={tr(`setup.categories.${c}`)}
                      selected={category === c}
                      onPress={() => setCategory(c)}
                    />
                  ),
                )}
              </View>
            </View>
            <SelectField
              label={tr('setup.county')}
              value={county}
              placeholder={tr('setup.countyPlaceholder')}
              onPress={() => setCountyOpen('person')}
              error={errors.county}
            />
            <TextField
              label={tr('setup.town')}
              optional
              placeholder="Westlands"
              value={town}
              onChangeText={setTown}
            />
            <TextField
              label={tr('setup.address')}
              optional
              placeholder={tr('setup.addressPlaceholder')}
              value={address}
              onChangeText={setAddress}
              icon="location"
            />
            <PinPicker
              label={tr('setup.pinLocation')}
              hint={tr('setup.pinHintDelivery')}
              value={point}
              onChange={setPoint}
              kind="buyer"
            />
            <PhoneField
              label={tr('setup.businessPhone')}
              optional
              placeholder={tr('auth.phonePlaceholder')}
              value={businessPhone}
              onChangeText={(v) => setBusinessPhone(v.replace(/[^\d ]/g, ''))}
              error={errors.businessPhone}
            />
            <TextField
              label={tr('setup.kraPin')}
              optional
              placeholder="P051234567X"
              value={kraPin}
              onChangeText={(v) => setKraPin(v.toUpperCase())}
              autoCapitalize="characters"
              maxLength={11}
            />
          </>
        )}

        {role === 'household' && (
          <>
            <TextField
              label={tr('auth.nameLabel')}
              placeholder={tr('auth.namePlaceholder')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              error={errors.name}
            />
            <SelectField
              label={tr('setup.county')}
              value={county}
              placeholder={tr('setup.countyPlaceholder')}
              onPress={() => setCountyOpen('person')}
              error={errors.county}
            />
            <TextField
              label={tr('setup.town')}
              optional
              placeholder="Kilimani"
              value={town}
              onChangeText={setTown}
            />
            <TextField
              label={tr('setup.address')}
              placeholder={tr('setup.addressPlaceholder')}
              value={address}
              onChangeText={setAddress}
              icon="location"
              error={errors.address}
            />
            <PinPicker
              label={tr('setup.pinLocation')}
              hint={tr('setup.pinHintDelivery')}
              value={point}
              onChange={setPoint}
              kind="buyer"
            />
          </>
        )}

        {role === 'youth' && (
          <>
            <TextField
              label={tr('setup.enterpriseName')}
              placeholder="Kijani Compost"
              value={businessName}
              onChangeText={setBusinessName}
              autoCapitalize="words"
              error={errors.businessName}
            />
            <SelectField
              label={tr('setup.county')}
              value={county}
              placeholder={tr('setup.countyPlaceholder')}
              onPress={() => setCountyOpen('person')}
              error={errors.county}
            />
            <TextField
              label={tr('setup.town')}
              optional
              placeholder="Thika"
              value={town}
              onChangeText={setTown}
            />
            <TextField
              label={tr('setup.address')}
              optional
              placeholder={tr('setup.addressPlaceholder')}
              value={address}
              onChangeText={setAddress}
              icon="location"
            />
            <PhoneField
              label={tr('setup.businessPhone')}
              optional
              placeholder={tr('auth.phonePlaceholder')}
              value={businessPhone}
              onChangeText={(v) => setBusinessPhone(v.replace(/[^\d ]/g, ''))}
              error={errors.businessPhone}
            />
          </>
        )}
      </Animated.View>

      <CountyPicker
        visible={countyOpen !== null}
        onClose={() => setCountyOpen(null)}
        value={countyOpen === 'farm' ? (farmCounty ?? county) : county}
        onSelect={(c) => (countyOpen === 'farm' ? setFarmCounty(c) : setCounty(c))}
      />
    </Screen>
  );
}
