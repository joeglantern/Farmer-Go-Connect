import { type AgentFarmerCreatedDto, normalizeKenyanPhone } from '@farmgo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../../data/session';
import {
  emptyFarm,
  type FarmDraft,
  FarmFields,
  farmBody,
  farmErrors,
} from '../../../features/agent/FarmFields';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Chip, Segmented, Switch } from '../../../ui/Controls';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../../ui/PhoneAndCode';
import {
  CountyPicker,
  DateOfBirthField,
  dobProblem,
  dobToIso,
  MIN_AGE,
  SelectField,
} from '../../../ui/Pickers';
import { Header, Screen } from '../../../ui/Screen';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

type Gender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';

const toE164 = (v: string) => normalizeKenyanPhone(`0${toLocalDigits(v)}`);

/** Field agent registers a farmer (who may not own a smartphone), optionally with their farm. */
export default function RegisterFarmer() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const dialog = useDialog();
  const qc = useQueryClient();
  const agentCounty = useSession((s) => s.me?.user.county ?? null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [county, setCounty] = useState<string | null>(agentCounty);
  const [gender, setGender] = useState<Gender>('UNDISCLOSED');
  const [dob, setDob] = useState({ d: '', m: '', y: '' });
  const [samePhone, setSamePhone] = useState(true);
  const [mpesa, setMpesa] = useState('');
  const [language, setLanguage] = useState<'sw' | 'en'>('sw');
  const [withFarm, setWithFarm] = useState(true);
  const [farm, setFarm] = useState<FarmDraft>(emptyFarm(agentCounty));
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = !!(name || phone || farm.name);

  const validate = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = tr('auth.errors.name');
    if (!toE164(phone)) e.phone = tr('auth.errors.phone');
    if (!county) e.county = tr('setup.countyPlaceholder');
    const dobErr = dobProblem(dob);
    if (dobErr)
      e.dob = tr(
        dobErr === 'invalid' ? 'setup.dobInvalid' : dobErr === 'tooYoung' ? 'agent.tooYoung' : 'agent.tooOld',
        { min: MIN_AGE },
      );
    if (!samePhone && !toE164(mpesa)) e.mpesa = tr('auth.errors.phone');
    if (withFarm) Object.assign(e, farmErrors(farm, tr));
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setFormError(null);
    if (!validate()) {
      toast.error(tr('agent.fixErrors'));
      return;
    }
    setBusy(true);
    try {
      const iso = dobToIso(dob);
      const res = await api.post<AgentFarmerCreatedDto>('/v1/agent/farmers', {
        phoneNumber: toE164(phone),
        name: name.trim(),
        county,
        gender,
        dateOfBirth: iso && iso !== 'invalid' ? iso : undefined,
        mpesaNumber: samePhone ? toE164(phone) : toE164(mpesa),
        preferredLanguage: language,
        farm: withFarm ? farmBody(farm) : undefined,
      });
      void qc.invalidateQueries({ queryKey: ['agentFarmers'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(tr('agent.registered', { name: res.user.name }));
      router.replace({ pathname: '/agent/farmer/[id]', params: { id: res.profile.id } });
    } catch (err) {
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: tr('agent.discardTitle'),
        message: tr('agent.discardBody'),
        confirmLabel: tr('agent.discard'),
        cancelLabel: tr('agent.keepEditing'),
        destructive: true,
      }))
    )
      return;
    router.back();
  };

  return (
    <Screen
      header={
        <Header
          title={tr('agent.registerTitle')}
          subtitle={tr('agent.registerSubtitle')}
          onBack={() => void leave()}
        />
      }
      maxWidth={t.layout.formMax + 120}
      footer={
        <Button
          label={tr('agent.registerSubmit')}
          icon="checkCircle"
          size="lg"
          loading={busy}
          onPress={() => void submit()}
        />
      }
    >
      <View style={{ gap: 20 }}>
        {formError && <Banner tone="danger" message={formError} />}

        <Card style={{ gap: 16 }}>
          <Text variant="title3">{tr('agent.aboutFarmer')}</Text>
          <TextField
            label={tr('agent.fullName')}
            placeholder={tr('agent.fullNamePlaceholder')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            error={errors.name}
            maxLength={120}
          />
          <PhoneField
            label={tr('agent.phone')}
            placeholder={tr('auth.phonePlaceholder')}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))}
            hint={tr('agent.phoneHint')}
            error={errors.phone}
          />
          <SelectField
            label={tr('setup.county')}
            value={county}
            placeholder={tr('setup.countyPlaceholder')}
            onPress={() => setPicker(true)}
            error={errors.county}
            icon="location"
          />
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('setup.gender')}</Text>
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
            hint={tr('agent.dobHint', { min: MIN_AGE })}
            error={errors.dob}
            value={dob}
            onChange={(v) => {
              setDob(v);
              if (errors.dob) setErrors(({ dob: _d, ...rest }) => rest);
            }}
          />
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('agent.language')}</Text>
            <Segmented
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'sw', label: tr('common.kiswahili') },
                { value: 'en', label: tr('common.english') },
              ]}
            />
          </View>
        </Card>

        <Card style={{ gap: 12 }}>
          <Text variant="title3">{tr('agent.payments')}</Text>
          <Switch
            value={samePhone}
            onChange={setSamePhone}
            label={tr('agent.mpesaSame')}
            description={tr('setup.mpesaHint')}
          />
          {!samePhone && (
            <PhoneField
              label={tr('setup.mpesa')}
              placeholder={tr('auth.phonePlaceholder')}
              value={mpesa}
              onChangeText={(v) => setMpesa(v.replace(/[^\d ]/g, ''))}
              error={errors.mpesa}
            />
          )}
        </Card>

        <Card style={{ gap: 16 }}>
          <Switch
            value={withFarm}
            onChange={setWithFarm}
            label={tr('agent.addFarmNow')}
            description={tr('agent.addFarmNowHint')}
          />
          {withFarm && <FarmFields value={farm} onChange={setFarm} errors={errors} />}
        </Card>

        <Text variant="caption" tone="tertiary" align="center">
          {tr('agent.consent')}
        </Text>
      </View>
      <CountyPicker
        visible={picker}
        onClose={() => setPicker(false)}
        value={county}
        onSelect={(c) => {
          setCounty(c);
          setFarm((f) => (f.county ? f : { ...f, county: c }));
        }}
      />
    </Screen>
  );
}
