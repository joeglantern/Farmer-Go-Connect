import type { AdminUserPageDto } from '@farmgo/contracts';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { z } from 'zod';
import { adminToken, type PlatformRole, useSession } from '../../../data/session';
import { request } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { Chip, Pill } from '../../../ui/Controls';
import type { IconName } from '../../../ui/Icon';
import { ListGroup, ListRow } from '../../../ui/ListRow';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { SearchField } from '../../../ui/TextField';

type UserPage = z.infer<typeof AdminUserPageDto>;
type Row = UserPage['items'][number];

const ROLES: { role: Exclude<PlatformRole, 'admin' | 'user'>; icon: IconName }[] = [
  { role: 'buyer', icon: 'building' },
  { role: 'farmer', icon: 'plant' },
  { role: 'input_supplier', icon: 'sprout' },
  { role: 'agent', icon: 'users' },
  { role: 'qa_officer', icon: 'shield' },
  { role: 'driver', icon: 'truck' },
];

/** Seeded demo people (apps/api/src/scripts/seed.ts) come first: they have realistic data. */
const isDemo = (u: Row) => u.email.endsWith('.test') || /^\+2547(11|22|33)0000/.test(u.phoneNumber ?? '');

/**
 * Admins only: open the app as any user to check that role's screens with real data
 * (Better Auth impersonation, 30 minutes). A banner leads back to the admin account.
 */
export default function ViewAs() {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const impersonating = useSession((s) => s.impersonating);
  const viewAs = useSession((s) => s.viewAs);
  const [role, setRole] = useState<(typeof ROLES)[number]['role']>('buyer');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['viewAsUsers', role, q.trim()],
    queryFn: ({ signal }) =>
      // While viewing as someone, the list still needs the admin's own token (QA APP-019).
      adminToken().then((asToken) =>
        request<UserPage>('GET', '/v1/admin/users', {
          query: { role, q: q.trim() || undefined, limit: 50 },
          signal,
          asToken,
        }),
      ),
    enabled: me?.user.role === 'admin' || impersonating,
  });

  const rows = useMemo(
    () =>
      (users.data?.items ?? [])
        .filter((u) => !u.banned)
        .sort((a, b) => Number(isDemo(b)) - Number(isDemo(a))),
    [users.data],
  );

  if (me && me.user.role !== 'admin' && !impersonating) return <Redirect href="/profile" />;

  const open = async (u: Row) => {
    const ok = await dialog.confirm({
      title: tr('viewAs.confirmTitle', { name: u.name }),
      message: tr('viewAs.confirmBody'),
      confirmLabel: tr('viewAs.open'),
      icon: 'eye',
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      await viewAs(u.id);
      router.replace('/home');
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen header={<Header title={tr('viewAs.title')} />} maxWidth={720}>
      <View style={{ gap: 16, paddingTop: 4 }}>
        <Text variant="callout" tone="secondary">
          {tr('viewAs.intro')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ROLES.map((r) => (
            <Chip
              key={r.role}
              label={tr(`roles.${r.role}`)}
              icon={r.icon}
              selected={role === r.role}
              onPress={() => setRole(r.role)}
            />
          ))}
        </View>
        <SearchField value={q} onChangeText={setQ} placeholder={tr('viewAs.search')} />
        {users.isLoading ? (
          <SkeletonList count={5} height={56} />
        ) : users.error ? (
          <ErrorState onRetry={() => users.refetch()} message={humanError(users.error)} />
        ) : rows.length === 0 ? (
          <EmptyState art="noResults" title={tr('viewAs.none')} compact />
        ) : (
          <ListGroup>
            {rows.map((u) => (
              <ListRow
                key={u.id}
                icon={ROLES.find((r) => r.role === role)?.icon ?? 'user'}
                label={u.name}
                detail={[u.phoneNumber, u.email.includes('phone.farmgo.local') ? null : u.email, u.county]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={isDemo(u) ? <Pill label={tr('viewAs.demo')} tone="brand" size="sm" /> : undefined}
                onPress={busy ? undefined : () => void open(u)}
              />
            ))}
          </ListGroup>
        )}
      </View>
    </Screen>
  );
}
