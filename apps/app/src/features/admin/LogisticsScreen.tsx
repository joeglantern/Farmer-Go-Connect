import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, dateShort, kes, timeAgo } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Chip, Divider, Segmented, Stepper } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { CountyPicker, SelectField } from '../../ui/Pickers';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { type Column, DataTable } from './DataTable';
import { type CrateRow, type RouteRow, useAdminMutations, useAdminRoutes, useCrate, useCrates } from './data';
import { AdminPage, Facts, goRoute, MoneyField, MutationError, StatusPill } from './ui';

type Tab = 'routes' | 'crates';
type DatePreset = 'yesterday' | 'today' | 'tomorrow' | 'all';

const CRATE_STATUSES = ['IN_STOCK', 'WITH_FARMER', 'IN_TRANSIT', 'WITH_BUYER', 'LOST', 'RETIRED'] as const;

function dayIso(offset: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}

/** APP_SPEC screen 59: routes by date, build routes, assign drivers, crates. */
export function LogisticsScreen() {
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<Tab>('routes');
  const [building, setBuilding] = useState(false);
  const [registering, setRegistering] = useState(false);
  const actions =
    tab === 'routes' ? (
      <Button
        label={tr('admin.logistics.build')}
        icon="route"
        size="sm"
        fullWidth={false}
        onPress={() => setBuilding(true)}
      />
    ) : (
      <Button
        label={tr('admin.logistics.registerCrates')}
        icon="crate"
        size="sm"
        fullWidth={false}
        onPress={() => setRegistering(true)}
      />
    );
  return (
    <AdminPage
      title={tr('admin.logistics.title')}
      subtitle={tr('admin.logistics.subtitle')}
      scroll={false}
      actions={actions}
    >
      <View style={{ paddingBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'routes', label: tr('admin.logistics.tabs.routes') },
            { value: 'crates', label: tr('admin.logistics.tabs.crates') },
          ]}
        />
      </View>
      {tab === 'routes' ? <RoutesTable /> : <CratesTable />}
      <BuildRoutesSheet visible={building} onClose={() => setBuilding(false)} />
      <RegisterCratesSheet visible={registering} onClose={() => setRegistering(false)} />
    </AdminPage>
  );
}

function RoutesTable() {
  const { t: tr } = useTranslation();
  const [preset, setPreset] = useState<DatePreset>('today');
  const [county, setCounty] = useState<string | undefined>();
  const [pickCounty, setPickCounty] = useState(false);
  const date =
    preset === 'all' ? undefined : dayIso(preset === 'yesterday' ? -1 : preset === 'tomorrow' ? 1 : 0);
  const query = useAdminRoutes({ date, county });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<RouteRow>[] = [
    {
      key: 'code',
      title: tr('admin.logistics.col.route'),
      flex: 1.6,
      primary: true,
      sort: (r) => r.code,
      render: (r) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numeric numberOfLines={1}>
            {r.code}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {r.county}
          </Text>
        </View>
      ),
    },
    {
      key: 'date',
      title: tr('admin.logistics.col.date'),
      width: 110,
      sort: (r) => r.date,
      render: (r) => (
        <Text variant="callout" numeric>
          {dateShort(r.date)}
        </Text>
      ),
    },
    {
      key: 'driver',
      title: tr('admin.logistics.col.driver'),
      flex: 1.2,
      sort: (r) => r.driver?.name ?? '',
      render: (r) =>
        r.driver ? (
          <Text variant="callout" numberOfLines={1}>
            {r.driver.name}
          </Text>
        ) : (
          <Text variant="callout" tone="warning">
            {tr('admin.logistics.unassigned')}
          </Text>
        ),
    },
    {
      key: 'stops',
      title: tr('admin.logistics.col.stops'),
      width: 70,
      align: 'right',
      sort: (r) => r._count.stops,
      render: (r) => (
        <Text variant="callout" numeric>
          {r._count.stops}
        </Text>
      ),
    },
    {
      key: 'distance',
      title: tr('admin.logistics.col.distance'),
      width: 90,
      align: 'right',
      hideBelow: 'expanded',
      sort: (r) => r.distanceKm ?? 0,
      render: (r) => (
        <Text variant="callout" numeric>
          {r.distanceKm !== null ? `${r.distanceKm} km` : ''}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 130,
      sort: (r) => r.status,
      render: (r) => <StatusPill status={r.status} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(r) => r.id}
      onRowPress={(r) => goRoute(r.id)}
      rowLabel={(r) => `${r.code}, ${r.county}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      empty={{
        art: 'noRoutes',
        title: tr('admin.logistics.emptyRoutes'),
        body: tr('admin.logistics.emptyRoutesBody'),
      }}
      header={
        <View style={{ paddingBottom: 12 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
          >
            {(['yesterday', 'today', 'tomorrow', 'all'] as DatePreset[]).map((p) => (
              <Chip
                key={p}
                label={tr(`admin.logistics.date.${p}`)}
                selected={preset === p}
                onPress={() => setPreset(p)}
              />
            ))}
            <Chip
              label={county ?? tr('admin.logistics.allCounties')}
              icon="location"
              selected={!!county}
              onPress={() => (county ? setCounty(undefined) : setPickCounty(true))}
            />
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

function BuildRoutesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { buildRoutes } = useAdminMutations();
  const [offset, setOffset] = useState<0 | 1>(1);
  const [county, setCounty] = useState<string | null>(null);
  const [pickCounty, setPickCounty] = useState(false);
  const date = dayIso(offset);

  const submit = async () => {
    const ok = await dialog.confirm({
      title: tr('admin.logistics.buildConfirm', { date: dateLong(date) }),
      message: tr('admin.logistics.buildConfirmBody', {
        county: county ?? tr('admin.logistics.allCounties').toLowerCase(),
      }),
      confirmLabel: tr('admin.logistics.build'),
      icon: 'route',
    });
    if (!ok) return;
    try {
      const res = await buildRoutes.mutateAsync({ date, county: county ?? undefined });
      toast.success(
        res.created ? tr('admin.logistics.built', { count: res.created }) : tr('admin.logistics.builtNone'),
      );
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('admin.logistics.buildTitle')}
      subtitle={tr('admin.logistics.buildBody')}
      footer={
        <Button
          label={tr('admin.logistics.build')}
          onPress={submit}
          loading={buildRoutes.isPending}
          icon="route"
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.logistics.buildFor')}</Text>
        <Segmented
          value={String(offset) as '0' | '1'}
          onChange={(v) => setOffset(v === '0' ? 0 : 1)}
          options={[
            { value: '0', label: tr('admin.logistics.date.today') },
            { value: '1', label: tr('admin.logistics.date.tomorrow') },
          ]}
        />
        <Text variant="caption" tone="tertiary">
          {dateLong(date)}
        </Text>
      </View>
      <SelectField
        label={tr('admin.common.county')}
        value={county}
        placeholder={tr('admin.logistics.allCounties')}
        onPress={() => setPickCounty(true)}
        icon="location"
      />
      {county && (
        <Button
          label={tr('admin.logistics.clearCounty')}
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={() => setCounty(null)}
        />
      )}
      <CountyPicker
        visible={pickCounty}
        onClose={() => setPickCounty(false)}
        value={county}
        onSelect={setCounty}
      />
      <MutationError error={buildRoutes.error} />
    </Sheet>
  );
}

function CratesTable() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [status, setStatus] = useState<string | undefined>();
  const [openQr, setOpenQr] = useState<string | null>(null);
  const query = useCrates(status);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = query.data?.pages[0]?.summary ?? {};

  const columns: Column<CrateRow>[] = [
    {
      key: 'qr',
      title: tr('admin.logistics.col.qr'),
      flex: 1.6,
      primary: true,
      sort: (c) => c.qrCode,
      render: (c) => (
        <Text variant="bodyStrong" numeric numberOfLines={1}>
          {c.qrCode}
        </Text>
      ),
    },
    {
      key: 'size',
      title: tr('admin.logistics.col.size'),
      width: 110,
      hideBelow: 'expanded',
      sort: (c) => c.size,
      render: (c) => <Text variant="callout">{c.size}</Text>,
    },
    {
      key: 'deposit',
      title: tr('admin.logistics.col.deposit'),
      width: 110,
      align: 'right',
      hideBelow: 'expanded',
      sort: (c) => c.depositCents,
      render: (c) => (
        <Text variant="callout" numeric>
          {kes(c.depositCents)}
        </Text>
      ),
    },
    {
      key: 'lastSeen',
      title: tr('admin.logistics.col.lastSeen'),
      width: 130,
      sort: (c) => c.lastSeenAt ?? '',
      render: (c) => (
        <Text variant="callout">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : tr('admin.common.never')}</Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 130,
      sort: (c) => c.status,
      render: (c) => <StatusPill status={c.status} size="sm" />,
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        keyOf={(c) => c.id}
        onRowPress={(c) => setOpenQr(c.qrCode)}
        rowLabel={(c) => `${c.qrCode}, ${c.status}`}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => query.refetch()}
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
        empty={{
          art: 'noListings',
          title: tr('admin.logistics.emptyCrates'),
          body: tr('admin.logistics.emptyCratesBody'),
        }}
        header={
          <View style={{ paddingBottom: 12, gap: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip
                label={tr('admin.logistics.fleet')}
                selected={!status}
                onPress={() => setStatus(undefined)}
                count={Object.values(summary).reduce((a, b) => a + b, 0) || undefined}
              />
              {CRATE_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={tr(`admin.status.${s}`)}
                  selected={status === s}
                  onPress={() => setStatus(status === s ? undefined : s)}
                  count={summary[s] || undefined}
                />
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="info" size={14} color={t.colors.textTertiary} />
              <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                {tr('admin.logistics.cratesNote')}
              </Text>
            </View>
          </View>
        }
      />
      <CrateSheet qrCode={openQr} onClose={() => setOpenQr(null)} />
    </>
  );
}

function CrateSheet({ qrCode, onClose }: { qrCode: string | null; onClose: () => void }) {
  const { t: tr } = useTranslation();
  const crate = useCrate(qrCode ?? undefined);
  const c = crate.data;
  return (
    <Sheet
      visible={!!qrCode}
      onClose={onClose}
      title={tr('admin.logistics.crate')}
      subtitle={qrCode ?? undefined}
    >
      {crate.isLoading && (
        <View style={{ gap: 10 }}>
          <Skeleton height={60} />
          <Skeleton height={120} />
        </View>
      )}
      {crate.error && (
        <ErrorState compact message={humanError(crate.error)} onRetry={() => crate.refetch()} />
      )}
      {c && (
        <>
          <Facts
            rows={[
              { label: tr('admin.people.col.status'), value: <StatusPill status={c.status} /> },
              { label: tr('admin.logistics.col.size'), value: c.size },
              { label: tr('admin.logistics.col.deposit'), value: kes(c.depositCents), numeric: true },
              {
                label: tr('admin.logistics.col.lastSeen'),
                value: c.lastSeenAt ? dateLong(c.lastSeenAt) : tr('admin.common.never'),
              },
            ]}
          />
          <Divider />
          <Text variant="headline">{tr('admin.logistics.movements')}</Text>
          {c.movements.length === 0 ? (
            <Text variant="callout" tone="secondary">
              {tr('admin.logistics.noMovements')}
            </Text>
          ) : (
            c.movements.map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                <StatusPill status={m.from} size="sm" />
                <Icon name="forward" size={14} />
                <StatusPill status={m.to} size="sm" />
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {m.scannedBy.name}
                  </Text>
                  <Text variant="caption" tone="tertiary" numeric>
                    {dateShort(m.createdAt)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </>
      )}
    </Sheet>
  );
}

function RegisterCratesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const size = useSizeClass();
  const { createCrates } = useAdminMutations();
  const [count, setCount] = useState(20);
  const [crateSize, setCrateSize] = useState('STANDARD');
  const [deposit, setDeposit] = useState<number | null>(50_000);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (count < 1 || count > 1000) return setError(tr('admin.logistics.countInvalid'));
    setError(null);
    const ok = await dialog.confirm({
      title: tr('admin.logistics.registerConfirm', { count }),
      message: tr('admin.logistics.registerBody', { deposit: kes(deposit ?? 0) }),
      confirmLabel: tr('admin.logistics.registerCrates'),
      icon: 'crate',
    });
    if (!ok) return;
    try {
      const res = await createCrates.mutateAsync({
        count,
        size: crateSize.trim() || 'STANDARD',
        depositCents: deposit ?? 0,
      });
      toast.success(tr('admin.logistics.registered', { count: res.created }));
      onClose();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('admin.logistics.registerTitle')}
      footer={
        <Button
          label={tr('admin.logistics.registerCrates')}
          onPress={submit}
          loading={createCrates.isPending}
          icon="crate"
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.logistics.count')}</Text>
        <View
          style={{
            flexDirection: size === 'compact' ? 'column' : 'row',
            alignItems: size === 'compact' ? 'flex-start' : 'center',
            gap: 12,
          }}
        >
          <Stepper
            value={count}
            onChange={setCount}
            min={1}
            max={1000}
            step={10}
            size="md"
            label={tr('admin.logistics.count')}
          />
          <Text variant="caption" tone="tertiary">
            {tr('admin.logistics.countHint')}
          </Text>
        </View>
        {error && (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
      <TextField
        label={tr('admin.logistics.size')}
        value={crateSize}
        onChangeText={setCrateSize}
        autoCapitalize="characters"
        hint={tr('admin.logistics.sizeHint')}
      />
      <MoneyField
        label={tr('admin.logistics.deposit')}
        cents={deposit}
        onChangeCents={setDeposit}
        hint={tr('admin.logistics.depositHint')}
      />
      <MutationError error={createCrates.error} />
    </Sheet>
  );
}
