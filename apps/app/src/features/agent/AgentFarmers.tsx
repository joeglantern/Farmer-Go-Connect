import type { AgentFarmerDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Avatar, Card, Chip, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { Stat } from '../qa/QaTasks';
import { kycView, prettyPhone, useAgentDashboard, useAgentFarmers } from './data';

type Filter = 'all' | 'noFarm' | 'kyc';

/** Field agent home: the farmers they registered, with quick access to each one. */
export function AgentFarmers() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const farmers = useAgentFarmers();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const dash = useAgentDashboard();
  const d = dash.data;
  const all = useMemo(() => farmers.data?.pages.flatMap((p) => p.items) ?? [], [farmers.data]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((f) => {
      if (filter === 'noFarm' && f.farms.length > 0) return false;
      if (filter === 'kyc' && f.kycStatus !== 'PENDING' && f.kycStatus !== 'SUBMITTED') return false;
      if (!n) return true;
      return (
        f.user.name.toLowerCase().includes(n) ||
        (f.user.phoneNumber ?? '').includes(n.replace(/\s/g, '')) ||
        f.farms.some((x) => x.name.toLowerCase().includes(n))
      );
    });
  }, [all, q, filter]);

  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const register = () => router.push('/agent/register');

  return (
    <Screen
      header={
        <Header
          title={tr('agent.homeTitle', { name: me?.user.name.split(' ')[0] ?? '' })}
          subtitle={tr('agent.homeSubtitle')}
          back={false}
          large
          right={
            size === 'compact' ? (
              <IconButton icon="plus" label={tr('agent.register')} variant="tinted" onPress={register} />
            ) : (
              <Button
                label={tr('agent.register')}
                icon="plus"
                size="md"
                fullWidth={false}
                onPress={register}
              />
            )
          }
        />
      }
      refreshing={farmers.isRefetching || dash.isRefetching}
      onRefresh={() => {
        void farmers.refetch();
        void dash.refetch();
      }}
    >
      <View style={{ gap: 16 }}>
        <View style={styles.stats}>
          {(
            [
              ['agent.farmers', d?.farmersOnboarded.allTime, 'users', false],
              ['agent.thisMonth', d?.farmersOnboarded.thisMonth, 'trendUp', false],
              ['agent.listingsCreated', d?.listingsCreated.allTime, 'basket', false],
              ['agent.kycToDo', d?.pendingKyc, 'idCard', !!d?.pendingKyc],
            ] as const
          ).map(([label, value, icon, warn]) => (
            <View key={label} style={{ width: size === 'compact' ? '47.9%' : '23.6%' }}>
              <Stat label={tr(label)} value={value == null ? null : String(value)} icon={icon} warn={warn} />
            </View>
          ))}
        </View>
        {dash.error && <ErrorState compact onRetry={() => void dash.refetch()} />}

        {all.length > 0 && (
          <>
            <SearchField value={q} onChangeText={setQ} placeholder={tr('agent.search')} />
            <View style={styles.chips}>
              <Chip
                label={tr('agent.filterAll')}
                selected={filter === 'all'}
                onPress={() => setFilter('all')}
                count={d?.farmersOnboarded.allTime}
              />
              <Chip
                label={tr('agent.filterNoFarm')}
                selected={filter === 'noFarm'}
                onPress={() => setFilter('noFarm')}
              />
              <Chip
                label={tr('agent.filterKyc')}
                selected={filter === 'kyc'}
                onPress={() => setFilter('kyc')}
                count={d?.pendingKyc}
              />
            </View>
          </>
        )}

        {farmers.isLoading ? (
          <SkeletonList count={4} height={96} />
        ) : farmers.error ? (
          <ErrorState onRetry={() => void farmers.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            art="noResults"
            title={tr('agent.emptyTitle')}
            body={tr('agent.emptyBody')}
            action={{ label: tr('agent.registerFirst'), onPress: register, icon: 'plus' }}
          />
        ) : list.length === 0 ? (
          <EmptyState
            compact
            art="noResults"
            title={tr('agent.noMatch')}
            action={{
              label: tr('agent.clearFilters'),
              onPress: () => {
                setQ('');
                setFilter('all');
              },
              icon: 'close',
            }}
          />
        ) : (
          <View style={styles.grid}>
            {list.map((f) => (
              <View key={f.id} style={{ width: columns === 1 ? '100%' : columns === 2 ? '48.8%' : '32.2%' }}>
                <FarmerCard farmer={f} />
              </View>
            ))}
          </View>
        )}
        {farmers.hasNextPage && (
          <Button
            label={tr('agent.loadMore')}
            variant="outline"
            loading={farmers.isFetchingNextPage}
            onPress={() => void farmers.fetchNextPage()}
          />
        )}
      </View>
    </Screen>
  );
}

function FarmerCard({ farmer }: { farmer: AgentFarmerDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const kyc = kycView(farmer.kycStatus);
  const acres = farmer.farms.reduce((s, f) => s + (f.acreage ?? 0), 0);
  return (
    <Card
      onPress={() => router.push({ pathname: '/agent/farmer/[id]', params: { id: farmer.id } })}
      accessibilityLabel={farmer.user.name}
      style={{ gap: 12 }}
    >
      <View style={styles.head}>
        <Avatar name={farmer.user.name} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {farmer.user.name}
          </Text>
          <Text variant="caption" tone="secondary" numeric numberOfLines={1}>
            {[prettyPhone(farmer.user.phoneNumber), farmer.user.county].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
      </View>
      <View style={styles.meta}>
        <Pill label={tr(kyc.labelKey)} tone={kyc.tone} size="sm" icon="idCard" />
        {farmer.farms.length === 0 ? (
          <Pill label={tr('agent.noFarmYet')} tone="warning" size="sm" icon="farm" />
        ) : (
          <Text variant="caption" tone="tertiary" numeric>
            {tr('agent.farmsCount', { count: farmer.farms.length })}
            {acres > 0 ? ` · ${tr('agent.acres', { n: Number(acres.toFixed(1)) })}` : ''}
          </Text>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
});
