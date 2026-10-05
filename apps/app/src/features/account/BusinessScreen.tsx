import type { CurrentOrgDto, OrgProfileDto } from '@farmgo/contracts';
import { normalizeKenyanPhone, UpdateOrgProfileInput } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { useSizeClass } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Avatar, Card, Chip, Pill } from '../../ui/Controls';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Banner } from '../../ui/overlays/Banner';
import { useToast } from '../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { CountyPicker, LocationButton, SelectField } from '../../ui/Pickers';
import { Header, Screen } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

const CATEGORIES = ['HOTEL', 'RESTAURANT', 'GUESTHOUSE', 'INSTITUTION', 'CATERER', 'OTHER'] as const;

/** The organization profile (PATCH /v1/orgs/current). Owners and org admins can edit. */
export function BusinessScreen() {
  const { t: tr } = useTranslation();
  const org = useQuery({
    queryKey: ['orgs', 'current'],
    queryFn: () => api.get<CurrentOrgDto>('/v1/orgs/current'),
  });
  return (
    <Screen
      header={<Header title={tr('business.title')} />}
      refreshing={org.isRefetching}
      onRefresh={() => org.refetch()}
    >
      {org.isLoading ? (
        <View style={{ gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={tr('common.loading')}>
          <Skeleton height={80} radius={14} />
          <Skeleton height={320} radius={14} />
        </View>
      ) : org.error || !org.data ? (
        <ErrorState message={humanError(org.error)} onRetry={() => org.refetch()} />
      ) : (
        <Body org={org.data} />
      )}
    </Screen>
  );
}

function Body({ org }: { org: CurrentOrgDto }) {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const toast = useToast();
  const qc = useQueryClient();
  const refreshMe = useSession((s) => s.refreshMe);
  const p = org.profile;
  const canEdit = ['owner', 'admin'].includes(org.memberRole);
  const household = (p?.buyerCategory as string | null | undefined) === 'HOUSEHOLD';
  const [county, setCounty] = useState<string | null>(p?.county ?? null);
  const [pickCounty, setPickCounty] = useState(false);
  const [town, setTown] = useState(p?.town ?? '');
  const [address, setAddress] = useState(p?.address ?? '');
  const [phone, setPhone] = useState(p?.phone ? toLocalDigits(p.phone) : '');
  const [email, setEmail] = useState(p?.email ?? '');
  const [kraPin, setKraPin] = useState(p?.kraPin ?? '');
  const [category, setCategory] = useState<string | null>(p?.buyerCategory ?? null);
  const [point, setPoint] = useState(p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: object) => api.patch<OrgProfileDto>('/v1/orgs/current', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orgs', 'current'] });
      void refreshMe();
    },
  });

  const submit = async () => {
    const e: Record<string, string> = {};
    const normalizedPhone = phone.trim() ? normalizeKenyanPhone(`0${toLocalDigits(phone)}`) : undefined;
    if (phone.trim() && !normalizedPhone) e.phone = tr('auth.errors.phone');
    const body = {
      county: county ?? undefined,
      town: town.trim() || undefined,
      address: address.trim() || undefined,
      phone: normalizedPhone ?? undefined,
      email: email.trim() || undefined,
      kraPin: kraPin.trim() || undefined,
      buyerCategory: household ? undefined : (category ?? undefined),
      lat: point?.lat,
      lng: point?.lng,
    };
    const parsed = UpdateOrgProfileInput.safeParse(body);
    if (!parsed.success)
      for (const i of parsed.error.issues)
        e[String(i.path[0])] ??= tr(`business.errors.${String(i.path[0])}`, { defaultValue: i.message });
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await save.mutateAsync(body);
      toast.success(tr('business.saved', { name: org.name }));
      router.back();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const header = (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Avatar name={org.name} uri={org.logo} size={52} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="title3">{org.name}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {p && (
            <Pill
              label={p.verified ? tr('profile.verified') : tr('profile.unverified')}
              tone={p.verified ? 'success' : 'warning'}
              size="sm"
            />
          )}
          {p && <Pill label={tr(`business.terms.${p.paymentTerms}`)} tone="neutral" size="sm" />}
          <Pill
            label={tr('business.yourRole', {
              role: tr(`business.roles.${org.memberRole}`, { defaultValue: org.memberRole }),
            })}
            tone="brand"
            size="sm"
          />
        </View>
      </View>
    </Card>
  );

  const members = (
    <ListGroup title={tr('business.members', { count: org.members.length })}>
      {org.members.map((m) => (
        <ListRow
          key={m.id}
          icon="user"
          label={m.user.name}
          detail={m.user.phoneNumber ?? m.user.email}
          value={tr(`business.roles.${m.role}`, { defaultValue: m.role })}
        />
      ))}
    </ListGroup>
  );

  const form = !canEdit ? (
    <Banner tone="info" message={tr('business.readOnly')} />
  ) : (
    <Card style={{ gap: 16 }}>
      {!household && (
        <View style={{ gap: 8 }}>
          <Text variant="calloutStrong">{tr('business.category')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={tr(`setup.categories.${c}`, { defaultValue: c })}
                selected={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
        </View>
      )}
      <SelectField
        label={tr('addresses.county')}
        value={county}
        placeholder={tr('addresses.pickCounty')}
        onPress={() => setPickCounty(true)}
        icon="location"
        error={errors.county}
      />
      <CountyPicker
        visible={pickCounty}
        onClose={() => setPickCounty(false)}
        value={county}
        onSelect={setCounty}
      />
      <TextField
        label={tr('addresses.town')}
        value={town}
        onChangeText={setTown}
        optional
        error={errors.town}
      />
      <TextField
        label={tr('business.address')}
        value={address}
        onChangeText={setAddress}
        optional
        error={errors.address}
      />
      <PhoneField
        label={tr('setup.businessPhone')}
        placeholder={tr('auth.phonePlaceholder')}
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))}
        error={errors.phone}
      />
      <TextField
        label={tr('auth.emailLabel')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        optional
        error={errors.email}
      />
      {!household && (
        <TextField
          label={tr('setup.kraPin')}
          value={kraPin}
          onChangeText={(v) => setKraPin(v.toUpperCase())}
          autoCapitalize="characters"
          optional
          error={errors.kraPin}
        />
      )}
      <View style={{ gap: 6 }}>
        <Text variant="calloutStrong">{tr('business.location')}</Text>
        <Text variant="caption" tone="secondary">
          {tr('business.locationHint')}
        </Text>
        <LocationButton value={point} onChange={setPoint} />
      </View>
      <Text variant="caption" tone="tertiary">
        {tr('business.termsNote')}
      </Text>
      <Button label={tr('common.saveChanges')} onPress={submit} loading={save.isPending} size="md" />
    </Card>
  );

  if (size !== 'compact') {
    return (
      <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 4 }}>
        <View style={{ flex: 1.3, gap: 16 }}>
          {header}
          {form}
        </View>
        <View style={{ flex: 1 }}>{members}</View>
      </View>
    );
  }
  return (
    <View style={{ gap: 16, paddingTop: 4 }}>
      {header}
      {form}
      {members}
    </View>
  );
}
