import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { dateShort, kes } from '../../lib/format';
import { Chip, Pill } from '../../ui/Controls';
import { Text } from '../../ui/Text';
import { type Column, DataTable } from './DataTable';
import {
  type AdminInvoiceRow,
  type AdminPaymentRow,
  type MoneyFilters,
  useAdminInvoices,
  useAdminPayments,
} from './data';
import { goOrg, goUser, StatCard, StatGrid, StatusPill } from './ui';

type Range = 'd30' | 'd90' | 'all';

function rangeOf(r: Range): Pick<MoneyFilters, 'from' | 'to'> {
  if (r === 'all') return {};
  const to = new Date();
  return {
    from: new Date(to.getTime() - (r === 'd30' ? 30 : 90) * 86_400_000).toISOString(),
    to: to.toISOString(),
  };
}

/** Status chips plus a date range, shared by both money lists. */
function Filters<S extends string>({
  statuses,
  status,
  onStatus,
  range,
  onRange,
  labelOf,
}: {
  statuses: readonly S[];
  status: S | undefined;
  onStatus: (s: S | undefined) => void;
  range: Range;
  onRange: (r: Range) => void;
  labelOf: (s: S) => string;
}) {
  const { t: tr } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, alignItems: 'center' }}
    >
      <Chip label={tr('admin.common.all')} selected={!status} onPress={() => onStatus(undefined)} />
      {statuses.map((s) => (
        <Chip
          key={s}
          label={labelOf(s)}
          selected={status === s}
          onPress={() => onStatus(status === s ? undefined : s)}
        />
      ))}
      <View style={{ width: 12 }} />
      {(['d30', 'd90', 'all'] as Range[]).map((r) => (
        <Chip
          key={r}
          label={tr(`admin.overview.range.${r}`)}
          selected={range === r}
          onPress={() => onRange(r)}
          icon="calendar"
        />
      ))}
    </ScrollView>
  );
}

const PAYMENT_STATUSES = ['SUCCESS', 'PENDING', 'FAILED', 'CANCELLED', 'TIMEOUT'] as const;

/** Every organization's payments (B28, GET /v1/admin/payments), with totals for the filter. */
export function PaymentsTable() {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<(typeof PAYMENT_STATUSES)[number] | undefined>();
  const [range, setRange] = useState<Range>('d30');
  const filters = useMemo(() => ({ status, ...rangeOf(range) }), [status, range]);
  const query = useAdminPayments(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = query.data?.pages[0]?.totals;
  const txLabel = (s: string) => tr(`admin.money.tx.${s}`, { defaultValue: s });

  const columns: Column<AdminPaymentRow>[] = [
    {
      key: 'payer',
      title: tr('admin.money.col.payer'),
      flex: 1.6,
      primary: true,
      sort: (p) => p.payer?.name.toLowerCase() ?? '',
      render: (p) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {p.payer?.name ?? tr('admin.common.notSet')}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1} numeric>
            {p.reference ?? p.mpesaReceipt ?? ''}
          </Text>
        </View>
      ),
    },
    {
      key: 'method',
      title: tr('admin.money.col.method'),
      width: 130,
      hideBelow: 'expanded',
      render: (p) => (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Text variant="callout">{tr(`admin.money.methods.${p.method}`, { defaultValue: p.method })}</Text>
          {p.direction === 'OUT' && <Pill label={tr('admin.money.refundTag')} tone="warning" size="sm" />}
        </View>
      ),
    },
    {
      key: 'amount',
      title: tr('admin.money.col.amount'),
      width: 130,
      align: 'right',
      sort: (p) => p.amount,
      render: (p) => (
        <Text variant="calloutStrong" numeric tone={p.direction === 'OUT' ? 'warning' : 'default'}>
          {p.direction === 'OUT' ? `-${kes(p.amount)}` : kes(p.amount)}
        </Text>
      ),
    },
    {
      key: 'date',
      title: tr('admin.money.col.date'),
      width: 110,
      sort: (p) => p.createdAt,
      render: (p) => (
        <Text variant="callout" numeric>
          {dateShort(p.createdAt)}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 130,
      sort: (p) => p.status,
      render: (p) => <Pill label={txLabel(p.status)} tone={txTone(p.status)} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(p) => p.id}
      onRowPress={(p) => p.payer && (p.payer.kind === 'org' ? goOrg(p.payer.id) : goUser(p.payer.id))}
      rowLabel={(p) => `${p.payer?.name ?? ''}, ${kes(p.amount)}, ${txLabel(p.status)}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      defaultSort={{ key: 'date', dir: 'desc' }}
      empty={{
        art: 'paymentReceived',
        title: tr('admin.money.emptyPayments'),
        body: tr('admin.money.emptyFiltered'),
      }}
      header={
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <StatGrid min={4}>
            <StatCard
              label={tr('admin.money.collected')}
              value={totals ? kes(totals.collectedCents) : null}
              icon="wallet"
              tone="success"
            />
            <StatCard
              label={tr('admin.money.refunded')}
              value={totals ? kes(totals.refundedCents) : null}
              icon="refresh"
              tone="warning"
            />
            <StatCard
              label={tr('admin.money.pending')}
              value={totals ? kes(totals.pendingCents) : null}
              icon="timer"
              tone="info"
            />
            <StatCard
              label={tr('admin.money.paymentsCount')}
              value={totals?.count}
              icon="receipt"
              tone="neutral"
            />
          </StatGrid>
          <Filters
            statuses={PAYMENT_STATUSES}
            status={status}
            onStatus={setStatus}
            range={range}
            onRange={setRange}
            labelOf={txLabel}
          />
        </View>
      }
    />
  );
}

function txTone(s: string) {
  return s === 'SUCCESS'
    ? 'success'
    : s === 'PENDING'
      ? 'info'
      : s === 'FAILED' || s === 'TIMEOUT'
        ? 'danger'
        : 'neutral';
}

const INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'VOID'] as const;

/** Every buyer's invoices (B28, GET /v1/admin/invoices), with totals for the filter. */
export function AdminInvoicesTable() {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<(typeof INVOICE_STATUSES)[number] | undefined>();
  const [range, setRange] = useState<Range>('d90');
  const filters = useMemo(() => ({ status, ...rangeOf(range) }), [status, range]);
  const query = useAdminInvoices(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = query.data?.pages[0]?.totals;

  const columns: Column<AdminInvoiceRow>[] = [
    {
      key: 'number',
      title: tr('admin.money.col.invoice'),
      flex: 1.2,
      primary: true,
      sort: (i) => i.number,
      render: (i) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numeric numberOfLines={1}>
            {i.number}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {i.buyerOrg.name}
          </Text>
        </View>
      ),
    },
    {
      key: 'period',
      title: tr('admin.money.col.period'),
      flex: 1.2,
      hideBelow: 'expanded',
      render: (i) => (
        <Text variant="callout" numeric>
          {tr('admin.money.period', { from: dateShort(i.periodStart), to: dateShort(i.periodEnd) })}
        </Text>
      ),
    },
    {
      key: 'orders',
      title: tr('admin.people.col.orders'),
      width: 70,
      align: 'right',
      hideBelow: 'expanded',
      sort: (i) => i._count.orders,
      render: (i) => (
        <Text variant="callout" numeric>
          {i._count.orders}
        </Text>
      ),
    },
    {
      key: 'total',
      title: tr('admin.money.col.total'),
      width: 120,
      align: 'right',
      sort: (i) => i.total,
      render: (i) => (
        <Text variant="callout" numeric>
          {kes(i.total)}
        </Text>
      ),
    },
    {
      key: 'due',
      title: tr('admin.money.col.balance'),
      width: 120,
      align: 'right',
      sort: (i) => i.total - i.amountPaid,
      render: (i) => (
        <Text variant="calloutStrong" numeric>
          {kes(Math.max(0, i.total - i.amountPaid))}
        </Text>
      ),
    },
    {
      key: 'dueAt',
      title: tr('admin.money.col.dueAt'),
      width: 110,
      sort: (i) => i.dueAt ?? '',
      render: (i) => (
        <Text variant="callout" numeric>
          {i.dueAt ? dateShort(i.dueAt) : ''}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 130,
      sort: (i) => i.status,
      render: (i) => <StatusPill status={i.status} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(i) => i.id}
      onRowPress={(i) => goOrg(i.buyerOrg.id)}
      rowLabel={(i) => `${i.number}, ${i.buyerOrg.name}, ${kes(i.total)}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      defaultSort={{ key: 'dueAt', dir: 'asc' }}
      empty={{
        art: 'noOrders',
        title: tr('admin.money.emptyInvoices'),
        body: tr('admin.money.emptyFiltered'),
      }}
      header={
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <StatGrid min={4}>
            <StatCard
              label={tr('admin.money.invoiced')}
              value={totals ? kes(totals.totalCents) : null}
              icon="invoice"
              tone="brand"
            />
            <StatCard
              label={tr('admin.money.paid')}
              value={totals ? kes(totals.paidCents) : null}
              icon="checkCircle"
              tone="success"
            />
            <StatCard
              label={tr('admin.money.due')}
              value={totals ? kes(totals.dueCents) : null}
              icon="timer"
              tone={totals && totals.dueCents > 0 ? 'warning' : 'neutral'}
            />
            <StatCard
              label={tr('admin.money.invoicesCount')}
              value={totals?.count}
              icon="receipt"
              tone="neutral"
            />
          </StatGrid>
          <Filters
            statuses={INVOICE_STATUSES}
            status={status}
            onStatus={setStatus}
            range={range}
            onRange={setRange}
            labelOf={(s) => tr(`admin.status.${s}`)}
          />
        </View>
      }
    />
  );
}
