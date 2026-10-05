import { PHONE_EMAIL_DOMAIN } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { timeAgo } from '../../lib/format';
import { useSizeClass } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Checkbox } from '../../ui/Controls';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

/** Better Auth session as listed by /api/auth/list-sessions. */
interface AuthSessionRow {
  id: string;
  token: string;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function deviceName(ua: string | null | undefined, fallback: string) {
  if (!ua) return fallback;
  if (/iphone|ipad/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return 'Android';
  if (/expo|okhttp/i.test(ua)) return 'FarmGo app';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome/i.test(ua)
      ? 'Chrome'
      : /firefox/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : null;
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /mac os/i.test(ua)
      ? 'Mac'
      : /linux/i.test(ua)
        ? 'Linux'
        : null;
  return [browser, os].filter(Boolean).join(', ') || fallback;
}

/** Password (email accounts) and signed-in devices. */
export function SecurityScreen() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const phoneOnly = !me?.user.email || me.user.email.endsWith(`@${PHONE_EMAIL_DOMAIN}`);
  const wide = size !== 'compact';
  return (
    <Screen header={<Header title={tr('security.title')} />} maxWidth={wide ? 980 : undefined}>
      <View
        style={
          wide
            ? { flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 4 }
            : { gap: 24, paddingTop: 4 }
        }
      >
        <View style={wide ? { flex: 1 } : undefined}>{phoneOnly ? <PhoneOnly /> : <ChangePassword />}</View>
        <View style={wide ? { flex: 1 } : undefined}>
          <Sessions />
        </View>
      </View>
    </Screen>
  );
}

function PhoneOnly() {
  const { t: tr } = useTranslation();
  const phone = useSession((s) => s.me?.user.phoneNumber);
  return (
    <ListGroup title={tr('security.signInMethod')}>
      <ListRow
        key="phone"
        icon="phone"
        label={tr('security.phoneSignIn')}
        value={phone ?? undefined}
        detail={tr('security.phoneSignInBody')}
      />
    </ListGroup>
  );
}

function ChangePassword() {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const adoptToken = useSession((s) => s.signInWithToken);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revoke, setRevoke] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: () =>
      api.post<{ token: string | null }>('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revoke,
      }),
  });

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!current) e.current = tr('security.errors.current');
    if (next.length < 8) e.next = tr('auth.errors.password');
    else if (next === current) e.next = tr('security.errors.same');
    if (confirm !== next) e.confirm = tr('reset.mismatch');
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const res = await change.mutateAsync();
      // Revoking other sessions also ends this one; Better Auth returns a fresh token to keep us signed in.
      if (res?.token) await adoptToken(res.token);
      toast.success(revoke ? tr('security.changedOthersOut') : tr('security.changed'));
      setCurrent('');
      setNext('');
      setConfirm('');
      void qc.invalidateQueries({ queryKey: ['authSessions'] });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_PASSWORD' || code === 'INVALID_EMAIL_OR_PASSWORD')
        setErrors({ current: tr('security.errors.wrongCurrent') });
      else toast.error(humanError(err));
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text
        variant="micro"
        tone="secondary"
        style={{ paddingHorizontal: 4, textTransform: 'uppercase' }}
        accessibilityRole="header"
      >
        {tr('security.password')}
      </Text>
      <Card style={{ gap: 14 }}>
        <TextField
          label={tr('security.current')}
          value={current}
          onChangeText={setCurrent}
          secureToggle
          autoComplete="current-password"
          textContentType="password"
          error={errors.current}
        />
        <TextField
          label={tr('reset.newPassword')}
          value={next}
          onChangeText={setNext}
          secureToggle
          autoComplete="new-password"
          textContentType="newPassword"
          hint={tr('auth.passwordPlaceholder')}
          error={errors.next}
        />
        <TextField
          label={tr('reset.confirm')}
          value={confirm}
          onChangeText={setConfirm}
          secureToggle
          autoComplete="new-password"
          error={errors.confirm}
          onSubmitEditing={submit}
        />
        <Checkbox checked={revoke} onChange={setRevoke} label={tr('security.signOutOthers')} />
        <Button label={tr('security.changePassword')} onPress={submit} loading={change.isPending} size="md" />
      </Card>
    </View>
  );
}

function Sessions() {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const qc = useQueryClient();
  const token = useSession((s) => s.token);
  const list = useQuery({
    queryKey: ['authSessions'],
    queryFn: () => api.get<AuthSessionRow[]>('/api/auth/list-sessions'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['authSessions'] });
  const revokeOne = useMutation({
    mutationFn: (t: string) => api.post('/api/auth/revoke-session', { token: t }),
    onSuccess: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post('/api/auth/revoke-other-sessions', {}),
    onSuccess: refresh,
  });
  const rows = [...(list.data ?? [])].sort((a, b) =>
    a.token === token ? -1 : b.token === token ? 1 : b.createdAt.localeCompare(a.createdAt),
  );
  const others = rows.filter((s) => s.token !== token);

  const signOutOne = async (s: AuthSessionRow) => {
    const name = deviceName(s.userAgent, tr('security.unknownDevice'));
    const ok = await dialog.confirm({
      title: tr('security.revokeTitle', { device: name }),
      message: tr('security.revokeBody'),
      confirmLabel: tr('common.signOut'),
      destructive: true,
      icon: 'logout',
    });
    if (!ok) return;
    try {
      await revokeOne.mutateAsync(s.token);
      toast.success(tr('security.revoked', { device: name }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const signOutOthers = async () => {
    const ok = await dialog.confirm({
      title: tr('security.revokeAllTitle', { count: others.length }),
      message: tr('security.revokeAllBody'),
      confirmLabel: tr('security.signOutEverywhere'),
      destructive: true,
      icon: 'logout',
    });
    if (!ok) return;
    try {
      await revokeOthers.mutateAsync();
      toast.success(tr('security.revokedAll'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  if (list.isLoading) return <SkeletonList count={3} height={56} />;
  if (list.error)
    return <ErrorState compact message={humanError(list.error)} onRetry={() => list.refetch()} />;
  return (
    <View style={{ gap: 12 }}>
      <ListGroup title={tr('security.devices')} footer={tr('security.devicesHint')}>
        {rows.map((s) => {
          const current = s.token === token;
          return (
            <ListRow
              key={s.id}
              icon={/android|iphone|expo|okhttp/i.test(s.userAgent ?? '') ? 'phone' : 'globe'}
              label={deviceName(s.userAgent, tr('security.unknownDevice'))}
              detail={[s.ipAddress, tr('security.signedIn', { when: timeAgo(s.createdAt) })]
                .filter(Boolean)
                .join(' · ')}
              value={current ? tr('security.thisDevice') : undefined}
              onPress={current ? undefined : () => signOutOne(s)}
              trailing={current ? null : undefined}
            />
          );
        })}
      </ListGroup>
      {others.length > 0 ? (
        <Button
          label={tr('security.signOutEverywhere')}
          icon="logout"
          variant="outline"
          size="md"
          onPress={signOutOthers}
          loading={revokeOthers.isPending}
        />
      ) : (
        <Banner tone="success" message={tr('security.onlyThis')} />
      )}
    </View>
  );
}
