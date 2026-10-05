import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../data/session';
import { humanError } from '../../lib/errors';
import { dateShort, kes } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Chip, Segmented } from '../../ui/Controls';
import { CountyPicker, SelectField } from '../../ui/Pickers';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { type ImpactRange, useImpactReport, useOpsSummary } from './data';
import { AdminPage, Facts, Section, StatCard, StatGrid, StatusPill } from './ui';

type Preset = 'd30' | 'd90' | 'm12' | 'all';

function rangeFor(preset: Preset): Pick<ImpactRange, 'from' | 'to'> {
  if (preset === 'all') return {};
  const days = preset === 'd30' ? 30 : preset === 'd90' ? 90 : 365;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/** APP_SPEC screen 55: operations summary and impact report. */
export function AdminOverview() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const summary = useOpsSummary();
  const [preset, setPreset] = useState<Preset>('d30');
  const [county, setCounty] = useState<string | null>(null);
  const [pickCounty, setPickCounty] = useState(false);
  const range = useMemo<ImpactRange>(
    () => ({ ...rangeFor(preset), county: county ?? undefined }),
    [preset, county],
  );
  const impact = useImpactReport(range);

  const s = summary.data;
  const orderStatuses = Object.entries(s?.ordersByStatus ?? {}).filter(([, n]) => n > 0);
  const activeOrders = orderStatuses
    .filter(([k]) => !['PAID', 'REFUNDED', 'CANCELLED', 'QA_REJECTED'].includes(k))
    .reduce((a, [, n]) => a + n, 0);

  return (
    <AdminPage
      title={tr('admin.overview.title')}
      subtitle={tr('admin.overview.subtitle', { name: me?.user.name.split(' ')[0] ?? '' })}
      refreshing={summary.isRefetching || impact.isRefetching}
      onRefresh={() => {
        void summary.refetch();
        void impact.refetch();
      }}
    >
      {summary.error && !s ? (
        <ErrorState message={humanError(summary.error)} onRetry={() => summary.refetch()} />
      ) : (
        <StatGrid min={3}>
          <StatCard
            label={tr('admin.overview.activeOrders')}
            value={s ? activeOrders : null}
            icon="orders"
            tone="brand"
            onPress={() => router.navigate('/orders')}
            hint={tr('admin.overview.viewOrders')}
          />
          <StatCard
            label={tr('admin.overview.openDisputes')}
            value={s?.openDisputes}
            icon="flag"
            tone={s?.openDisputes ? 'danger' : 'neutral'}
            onPress={() => router.navigate({ pathname: '/money', params: { tab: 'disputes' } })}
            hint={tr('admin.overview.viewDisputes')}
          />
          <StatCard
            label={tr('admin.overview.failedPayouts')}
            value={s?.failedPayouts}
            icon="wallet"
            tone={s?.failedPayouts ? 'danger' : 'neutral'}
            onPress={() => router.navigate({ pathname: '/money', params: { tab: 'payouts' } })}
            hint={tr('admin.overview.viewPayouts')}
          />
          <StatCard
            label={tr('admin.overview.pendingPayments')}
            value={s?.pendingPayments}
            icon="timer"
            tone={s?.pendingPayments ? 'warning' : 'neutral'}
          />
          <StatCard
            label={tr('admin.overview.pendingKyc')}
            value={s?.pendingKyc}
            icon="idCard"
            tone={s?.pendingKyc ? 'warning' : 'neutral'}
            onPress={() => router.navigate({ pathname: '/people', params: { tab: 'kyc' } })}
            hint={tr('admin.overview.viewKyc')}
          />
          <StatCard
            label={tr('admin.overview.openDemand')}
            value={s?.openDemand}
            icon="megaphone"
            tone="info"
          />
          <StatCard
            label={tr('admin.overview.openListings')}
            value={s?.openListings}
            icon="basket"
            tone="success"
          />
        </StatGrid>
      )}

      <View style={{ marginTop: 20 }}>
        <Section title={tr('admin.overview.ordersByStatus')}>
          {summary.isLoading ? (
            <Skeleton height={32} />
          ) : orderStatuses.length === 0 ? (
            <Text variant="callout" tone="secondary">
              {tr('admin.overview.noOrders')}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {orderStatuses.map(([status, n]) => (
                <View
                  key={status}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 }}
                >
                  <StatusPill status={status} />
                  <Text variant="calloutStrong" numeric>
                    {n}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Section>
      </View>

      <View style={{ marginTop: 28, gap: 12 }}>
        <View
          style={{
            flexDirection: size === 'compact' ? 'column' : 'row',
            gap: 12,
            alignItems: size === 'compact' ? 'stretch' : 'flex-end',
          }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="title3" accessibilityRole="header">
              {tr('admin.overview.impact')}
            </Text>
            <Text variant="callout" tone="secondary">
              {impact.data
                ? tr('admin.overview.rangeLabel', {
                    from: dateShort(impact.data.range.from),
                    to: dateShort(impact.data.range.to),
                  })
                : ' '}
            </Text>
          </View>
          <View style={{ width: size === 'compact' ? undefined : 360 }}>
            <Segmented
              value={preset}
              onChange={setPreset}
              options={[
                { value: 'd30', label: tr('admin.overview.range.d30') },
                { value: 'd90', label: tr('admin.overview.range.d90') },
                { value: 'm12', label: tr('admin.overview.range.m12') },
                { value: 'all', label: tr('admin.overview.range.all') },
              ]}
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip label={tr('admin.overview.allCounties')} selected={!county} onPress={() => setCounty(null)} />
          <View style={{ flexGrow: 0, minWidth: 200 }}>
            <SelectField
              label=""
              value={county}
              placeholder={tr('admin.overview.pickCounty')}
              onPress={() => setPickCounty(true)}
              icon="location"
            />
          </View>
        </View>
        <CountyPicker
          visible={pickCounty}
          onClose={() => setPickCounty(false)}
          value={county}
          onSelect={setCounty}
        />

        {impact.error && !impact.data ? (
          <ErrorState message={humanError(impact.error)} onRetry={() => impact.refetch()} />
        ) : (
          <ImpactBody data={impact.data} loading={impact.isLoading} />
        )}
        <Text variant="caption" tone="tertiary" style={{ color: t.colors.textTertiary }}>
          {tr('admin.overview.impactNote')}
        </Text>
      </View>
    </AdminPage>
  );
}

function ImpactBody({
  data,
  loading,
}: {
  data: ReturnType<typeof useImpactReport>['data'];
  loading: boolean;
}) {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  if (loading || !data) {
    return (
      <View style={{ gap: 12 }} accessibilityRole="progressbar">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={132} radius={14} />
        ))}
      </View>
    );
  }
  const d = data;
  const blocks = [
    {
      title: tr('admin.overview.farmers'),
      rows: [
        {
          label: tr('admin.overview.farmersTotal'),
          value: d.farmers.total.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.newFarmers'),
          value: d.farmers.newInRange.toLocaleString('en-KE'),
          numeric: true,
        },
        { label: tr('admin.overview.youth'), value: pct(d.farmers.youthPct), numeric: true },
        { label: tr('admin.overview.women'), value: pct(d.farmers.womenPct), numeric: true },
      ],
    },
    {
      title: tr('admin.overview.trade'),
      rows: [
        { label: tr('admin.overview.orders'), value: d.trade.orders.toLocaleString('en-KE'), numeric: true },
        {
          label: tr('admin.overview.activeBuyers'),
          value: d.trade.activeBuyers.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.kgTraded'),
          value: `${Math.round(d.trade.kgTraded).toLocaleString('en-KE')} kg`,
          numeric: true,
        },
        { label: tr('admin.overview.grossValue'), value: kes(d.trade.grossValueCents), numeric: true },
        {
          label: tr('admin.overview.preHarvest'),
          value: `${Math.round(d.trade.preHarvestMatchedKg).toLocaleString('en-KE')} kg (${pct(d.trade.preHarvestMatchedPct)})`,
          numeric: true,
        },
      ],
    },
    {
      title: tr('admin.overview.income'),
      rows: [
        { label: tr('admin.overview.paidOut'), value: kes(d.farmerIncome.paidOutCents), numeric: true },
        {
          label: tr('admin.overview.farmersPaid'),
          value: d.farmerIncome.farmersPaid.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.inspected'),
          value: d.quality.inspected.toLocaleString('en-KE'),
          numeric: true,
        },
        { label: tr('admin.overview.passRate'), value: pct(d.quality.passRatePct), numeric: true },
      ],
    },
    {
      title: tr('admin.overview.packaging'),
      rows: [
        {
          label: tr('admin.overview.activeCrates'),
          value: d.packaging.activeCrates.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.crateTrips'),
          value: d.packaging.crateTrips.toLocaleString('en-KE'),
          numeric: true,
        },
        { label: tr('admin.overview.returnRate'), value: pct(d.packaging.returnRatePct), numeric: true },
        {
          label: tr('admin.overview.lostCrates'),
          value: d.packaging.lost.toLocaleString('en-KE'),
          numeric: true,
        },
      ],
    },
    {
      title: tr('admin.overview.logistics'),
      rows: [
        {
          label: tr('admin.overview.routes'),
          value: d.logistics.routes.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.stops'),
          value: d.logistics.stops.toLocaleString('en-KE'),
          numeric: true,
        },
        {
          label: tr('admin.overview.distance'),
          value: `${d.logistics.distanceKm.toLocaleString('en-KE')} km`,
          numeric: true,
        },
      ],
    },
    {
      title: tr('admin.overview.youthJobs'),
      rows: [
        { label: tr('roles.agent'), value: d.youthJobs.agents, numeric: true },
        { label: tr('roles.qa_officer'), value: d.youthJobs.qaOfficers, numeric: true },
        { label: tr('roles.driver'), value: d.youthJobs.drivers, numeric: true },
        { label: tr('roles.admin'), value: d.youthJobs.admins, numeric: true },
      ],
    },
  ];
  const cols = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
      {blocks.map((b) => (
        <View key={b.title} style={{ width: `${100 / cols}%`, padding: 6 }}>
          <Section title={b.title} style={{ minHeight: 150 }}>
            <Facts rows={b.rows} columns={2} />
          </Section>
        </View>
      ))}
    </View>
  );
}
