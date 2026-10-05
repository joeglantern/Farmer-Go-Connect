import { PLATFORM_ROLES } from '@farmgo/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { dateShort, kes } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Avatar, Chip, Pill, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { CountyPicker } from '../../ui/Pickers';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { type Column, DataTable } from './DataTable';
import {
  type AdminOrgRow,
  type AdminUserRow,
  type KycRow,
  useAdminOrgs,
  useAdminUsers,
  useKycQueue,
} from './data';
import { AdminPage, goOrg, goUser, StatusPill } from './ui';

type Tab = 'users' | 'kyc' | 'orgs';

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** APP_SPEC screen 57: users, KYC queue, organizations. */
export function PeopleScreen() {
  const { t: tr } = useTranslation();
  // The Overview's Pending KYC card opens the KYC tab with ?tab=kyc.
  const params = useLocalSearchParams<{ tab?: string }>();
  const asked = (['users', 'kyc', 'orgs'] as const).find((x) => x === params.tab);
  const [tab, setTab] = useState<Tab>(asked ?? 'users');
  useEffect(() => {
    if (asked) setTab(asked);
  }, [asked]);
  return (
    <AdminPage title={tr('admin.people.title')} subtitle={tr('admin.people.subtitle')} scroll={false}>
      <View style={{ paddingBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'users', label: tr('admin.people.tabs.users') },
            { value: 'kyc', label: tr('admin.people.tabs.kyc') },
            { value: 'orgs', label: tr('admin.people.tabs.orgs') },
          ]}
        />
      </View>
      {tab === 'users' && <UsersTable />}
      {tab === 'kyc' && <KycTable />}
      {tab === 'orgs' && <OrgsTable />}
    </AdminPage>
  );
}

function UsersTable() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string | undefined>();
  const [county, setCounty] = useState<string | undefined>();
  const [pickCounty, setPickCounty] = useState(false);
  const query = useAdminUsers({ q: useDebounced(q) || undefined, role, county });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'name',
      title: tr('admin.people.col.name'),
      flex: 2,
      primary: true,
      sort: (u) => u.name.toLowerCase(),
      render: (u) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={u.name} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {u.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {u.email.endsWith('phone.farmgo.local') ? (u.phoneNumber ?? '') : u.email}
            </Text>
          </View>
        </View>
      ),
    },
    {
      key: 'role',
      title: tr('admin.people.col.role'),
      sort: (u) => u.role ?? '',
      render: (u) => (
        <Pill label={tr(`roles.${u.role ?? 'user'}`)} tone={u.role === 'admin' ? 'brand' : 'neutral'} />
      ),
    },
    {
      key: 'county',
      title: tr('admin.people.col.county'),
      hideBelow: 'expanded',
      sort: (u) => u.county ?? '',
      render: (u) => <Text variant="callout">{u.county ?? tr('admin.common.notSet')}</Text>,
    },
    {
      key: 'kyc',
      title: tr('admin.people.col.kyc'),
      render: (u) =>
        u.farmerProfile ? (
          <StatusPill status={u.farmerProfile.kycStatus} size="sm" />
        ) : (
          <Text variant="caption" tone="tertiary">
            {tr('admin.common.none')}
          </Text>
        ),
    },
    {
      key: 'orders',
      title: tr('admin.people.col.orders'),
      width: 80,
      align: 'right',
      hideBelow: 'expanded',
      sort: (u) => u.farmerProfile?.ordersCompleted ?? -1,
      render: (u) => (
        <Text variant="callout" numeric>
          {u.farmerProfile ? u.farmerProfile.ordersCompleted : ''}
        </Text>
      ),
    },
    {
      key: 'joined',
      title: tr('admin.people.col.joined'),
      width: 110,
      sort: (u) => u.createdAt,
      render: (u) => (
        <Text variant="callout" numeric>
          {dateShort(u.createdAt)}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 110,
      render: (u) => <StatusPill status={u.banned ? 'BANNED' : 'ACTIVE'} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(u) => u.id}
      onRowPress={(u) => goUser(u.id)}
      rowLabel={(u) => u.name}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      empty={{
        art: 'noResults',
        title: tr('admin.people.emptyUsers'),
        body: tr('admin.people.emptyUsersBody'),
      }}
      defaultSort={{ key: 'joined', dir: 'desc' }}
      header={
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <SearchField value={q} onChangeText={setQ} placeholder={tr('admin.people.searchUsers')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
          >
            <Chip label={tr('admin.people.allRoles')} selected={!role} onPress={() => setRole(undefined)} />
            {PLATFORM_ROLES.filter((r) => r !== 'user').map((r) => (
              <Chip
                key={r}
                label={tr(`roles.${r}`)}
                selected={role === r}
                onPress={() => setRole(role === r ? undefined : r)}
              />
            ))}
            <View style={{ width: 1, height: 24, backgroundColor: t.colors.line, marginHorizontal: 4 }} />
            <Chip
              label={county ?? tr('admin.people.anyCounty')}
              icon="location"
              selected={!!county}
              onPress={() => (county ? setCounty(undefined) : setPickCounty(true))}
            />
            {county && <Icon name="close" size={14} color={t.colors.textTertiary} />}
          </ScrollView>
          <CountyPicker
            visible={pickCounty}
            onClose={() => setPickCounty(false)}
            value={county}
            onSelect={setCounty}
          />
        </View>
      }
    />
  );
}

function KycTable() {
  const { t: tr } = useTranslation();
  const query = useKycQueue();
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: Column<KycRow>[] = [
    {
      key: 'farmer',
      title: tr('admin.people.col.name'),
      flex: 2,
      primary: true,
      sort: (r) => r.user.name.toLowerCase(),
      render: (r) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={r.user.name} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {r.user.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {r.user.phoneNumber ?? ''}
            </Text>
          </View>
        </View>
      ),
    },
    {
      key: 'county',
      title: tr('admin.people.col.county'),
      sort: (r) => r.user.county ?? '',
      render: (r) => <Text variant="callout">{r.user.county ?? tr('admin.common.notSet')}</Text>,
    },
    {
      key: 'mpesa',
      title: tr('admin.user.mpesa'),
      hideBelow: 'expanded',
      render: (r) => (
        <Text variant="callout" numeric>
          {r.mpesaNumber}
        </Text>
      ),
    },
    {
      key: 'orders',
      title: tr('admin.people.col.orders'),
      width: 80,
      align: 'right',
      sort: (r) => r.ordersCompleted,
      render: (r) => (
        <Text variant="callout" numeric>
          {r.ordersCompleted}
        </Text>
      ),
    },
    {
      key: 'submitted',
      title: tr('admin.people.col.submitted'),
      width: 110,
      sort: (r) => r.updatedAt,
      render: (r) => (
        <Text variant="callout" numeric>
          {dateShort(r.updatedAt)}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 120,
      render: (r) => <StatusPill status={r.kycStatus} size="sm" />,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(r) => r.id}
      onRowPress={(r) => goUser(r.user.id)}
      rowLabel={(r) => r.user.name}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      empty={{ art: 'noResults', title: tr('admin.people.emptyKyc'), body: tr('admin.people.emptyKycBody') }}
      header={
        <Text variant="callout" tone="secondary" style={{ paddingBottom: 12 }}>
          {tr('admin.people.kycBody')}
        </Text>
      }
    />
  );
}

function OrgsTable() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const query = useAdminOrgs();
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: Column<AdminOrgRow>[] = [
    {
      key: 'name',
      title: tr('admin.people.col.org'),
      flex: 2,
      primary: true,
      sort: (o) => o.name.toLowerCase(),
      render: (o) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundColor: t.colors.primaryTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name={
                o.profile?.type === 'INPUT_SUPPLIER'
                  ? 'sprout'
                  : o.profile?.type === 'FARMER_GROUP'
                    ? 'users'
                    : 'building'
              }
              size={16}
              color={t.colors.primary}
              weight="fill"
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {o.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {o.profile?.county ?? ''}
              {o.profile?.town ? `, ${o.profile.town}` : ''}
            </Text>
          </View>
        </View>
      ),
    },
    {
      key: 'type',
      title: tr('admin.people.col.type'),
      sort: (o) => o.profile?.type ?? '',
      render: (o) => (
        <Text variant="callout">
          {o.profile
            ? tr(`admin.org.types.${o.profile.buyerCategory ?? o.profile.type}`, {
                defaultValue: o.profile.type,
              })
            : tr('admin.common.none')}
        </Text>
      ),
    },
    {
      key: 'members',
      title: tr('admin.people.col.members'),
      width: 90,
      align: 'right',
      hideBelow: 'expanded',
      sort: (o) => o._count.members,
      render: (o) => (
        <Text variant="callout" numeric>
          {o._count.members}
        </Text>
      ),
    },
    {
      key: 'orders',
      title: tr('admin.people.col.orders'),
      width: 80,
      align: 'right',
      sort: (o) => o._count.orders,
      render: (o) => (
        <Text variant="callout" numeric>
          {o._count.orders}
        </Text>
      ),
    },
    {
      key: 'terms',
      title: tr('admin.people.col.terms'),
      hideBelow: 'expanded',
      render: (o) =>
        o.profile ? (
          <Text
            variant="callout"
            numeric
          >{`${tr(`admin.status.${o.profile.paymentTerms}`)}${o.profile.creditLimit ? ` · ${kes(o.profile.creditLimit)}` : ''}`}</Text>
        ) : null,
    },
    {
      key: 'verified',
      title: tr('admin.people.col.verified'),
      width: 120,
      sort: (o) => (o.profile?.verified ? 1 : 0),
      render: (o) => <StatusPill status={o.profile?.verified ? 'VERIFIED' : 'PENDING'} size="sm" />,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(o) => o.id}
      onRowPress={(o) => goOrg(o.id)}
      rowLabel={(o) => o.name}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      empty={{
        art: 'noResults',
        title: tr('admin.people.emptyOrgs'),
        body: tr('admin.people.emptyOrgsBody'),
      }}
    />
  );
}
