import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateShort, kes } from '../../lib/format';
import { useSizeClass } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Chip, RadioRow, Segmented } from '../../ui/Controls';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { type Column, DataTable } from './DataTable';
import { DisputesTable } from './DisputesTable';
import { type AdminPayoutRow, useAdminMutations, useAdminPayouts } from './data';
import { AdminInvoicesTable, PaymentsTable } from './MoneyLists';
import { AdminPage, MoneyField, MutationError, Section, StatusPill } from './ui';

type Tab = 'payouts' | 'payments' | 'invoices' | 'disputes' | 'manual';
const TABS: Tab[] = ['payouts', 'payments', 'invoices', 'disputes', 'manual'];
type PayoutStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

/** APP_SPEC screen 58: payouts (retry failed), disputes and refunds, record a manual payment. */
export function MoneyScreen() {
  const { t: tr } = useTranslation();
  // Overview cards open a given tab with ?tab=.
  const params = useLocalSearchParams<{ tab?: string }>();
  const asked = TABS.find((x) => x === params.tab);
  const [tab, setTab] = useState<Tab>(asked ?? 'payouts');
  useEffect(() => {
    if (asked) setTab(asked);
  }, [asked]);
  return (
    <AdminPage
      title={tr('admin.money.title')}
      subtitle={tr('admin.money.subtitle')}
      scroll={tab === 'manual'}
    >
      <View style={{ paddingBottom: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TABS.map((k) => (
            <Chip
              key={k}
              label={tr(`admin.money.tabs.${k}`)}
              selected={tab === k}
              onPress={() => setTab(k)}
            />
          ))}
        </ScrollView>
      </View>
      {tab === 'payouts' && <PayoutsTable />}
      {tab === 'payments' && <PaymentsTable />}
      {tab === 'invoices' && <AdminInvoicesTable />}
      {tab === 'disputes' && <DisputesTable />}
      {tab === 'manual' && <ManualPayment />}
    </AdminPage>
  );
}

function PayoutsTable() {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { retryPayout } = useAdminMutations();
  const [status, setStatus] = useState<PayoutStatus | undefined>('FAILED');
  const query = useAdminPayouts(status);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const retry = async (p: AdminPayoutRow) => {
    if (!p.orderId) return;
    const ok = await dialog.confirm({
      title: tr('admin.money.retryConfirm', { amount: kes(p.amount), name: p.farmer.name }),
      message: tr('admin.money.retryBody', { phone: p.phoneNumber }),
      confirmLabel: tr('admin.money.retry'),
      icon: 'wallet',
    });
    if (!ok) return;
    try {
      const res = await retryPayout.mutateAsync({ orderId: p.orderId });
      toast.success(
        res ? tr('admin.money.retried', { name: p.farmer.name }) : tr('admin.money.retryNothing'),
      );
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const columns: Column<AdminPayoutRow>[] = [
    {
      key: 'farmer',
      title: tr('admin.money.col.farmer'),
      flex: 2,
      primary: true,
      sort: (p) => p.farmer.name.toLowerCase(),
      render: (p) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {p.farmer.name}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1} numeric>
            {p.phoneNumber}
          </Text>
        </View>
      ),
    },
    {
      key: 'order',
      title: tr('admin.money.col.order'),
      sort: (p) => p.order?.code ?? '',
      render: (p) => (
        <Text variant="callout" numeric>
          {p.order?.code ?? ''}
        </Text>
      ),
    },
    {
      key: 'amount',
      title: tr('admin.money.col.amount'),
      width: 120,
      align: 'right',
      sort: (p) => p.amount,
      render: (p) => (
        <Text variant="calloutStrong" numeric>
          {kes(p.amount)}
        </Text>
      ),
    },
    {
      key: 'commission',
      title: tr('admin.money.col.commission'),
      width: 110,
      align: 'right',
      hideBelow: 'expanded',
      sort: (p) => p.commission,
      render: (p) => (
        <Text variant="callout" tone="secondary" numeric>
          {kes(p.commission)}
        </Text>
      ),
    },
    {
      key: 'attempts',
      title: tr('admin.money.col.attempts'),
      width: 80,
      align: 'right',
      hideBelow: 'expanded',
      sort: (p) => p.attempts,
      render: (p) => (
        <Text variant="callout" numeric>
          {p.attempts}
        </Text>
      ),
    },
    {
      key: 'updated',
      title: tr('admin.money.col.updated'),
      width: 110,
      sort: (p) => p.updatedAt,
      render: (p) => (
        <Text variant="callout" numeric>
          {dateShort(p.updatedAt)}
        </Text>
      ),
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 170,
      render: (p) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <StatusPill status={p.status} size="sm" />
          {p.status === 'FAILED' && (
            <Button
              label={tr('admin.money.retry')}
              size="sm"
              variant="secondary"
              fullWidth={false}
              onPress={() => retry(p)}
              loading={retryPayout.isPending && retryPayout.variables?.orderId === p.orderId}
            />
          )}
        </View>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(p) => p.id}
      rowLabel={(p) => `${p.farmer.name}, ${kes(p.amount)}, ${p.status}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      defaultSort={{ key: 'updated', dir: 'desc' }}
      empty={{
        art: 'paymentReceived',
        title: tr('admin.money.emptyPayouts'),
        body: tr('admin.money.emptyPayoutsBody'),
      }}
      header={
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
        >
          {(['FAILED', 'PENDING', 'SUCCESS'] as PayoutStatus[]).map((s) => (
            <Chip
              key={s}
              label={tr(`admin.status.${s}`)}
              selected={status === s}
              onPress={() => setStatus(s)}
            />
          ))}
          <Chip
            label={tr('admin.money.payoutStatusAll')}
            selected={!status}
            onPress={() => setStatus(undefined)}
          />
        </ScrollView>
      }
      footer={
        <Text variant="caption" tone="tertiary" align="center">
          {tr('admin.money.payoutsNote')}
        </Text>
      }
    />
  );
}

function ManualPayment() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const { manualPayment } = useAdminMutations();
  const [target, setTarget] = useState<'order' | 'invoice'>('order');
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'CASH'>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!targetId.trim()) e.target = tr('admin.money.targetInvalid');
    if (!amount || amount <= 0) e.amount = tr('admin.money.amountInvalid');
    if (reference.trim().length < 3) e.reference = tr('admin.money.referenceInvalid');
    setErrors(e);
    if (Object.keys(e).length) return;
    const ok = await dialog.confirm({
      title: tr('admin.money.recordConfirm', {
        amount: kes(amount!),
        method: tr(`admin.money.${method === 'CASH' ? 'cash' : 'bank'}`).toLowerCase(),
        target: targetId.trim(),
      }),
      message: tr('admin.money.recordBody'),
      confirmLabel: tr('admin.money.record'),
      icon: 'bank',
    });
    if (!ok) return;
    try {
      await manualPayment.mutateAsync({
        // The API takes the code people see (FG-26-001000, INV-26-00012) or the internal id.
        [target === 'order' ? 'orderId' : 'invoiceId']: /^(fg|inv)-/i.test(targetId.trim())
          ? targetId.trim().toUpperCase()
          : targetId.trim(),
        amount: amount!,
        method,
        reference: reference.trim(),
      } as Parameters<typeof manualPayment.mutateAsync>[0]);
      toast.success(tr('admin.money.recorded', { amount: kes(amount!) }));
      setTargetId('');
      setAmount(null);
      setReference('');
      setFormKey((k) => k + 1);
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <View style={{ maxWidth: 560, width: '100%', alignSelf: size === 'compact' ? 'stretch' : 'flex-start' }}>
      <Section title={tr('admin.money.manualTitle')}>
        <Text variant="callout" tone="secondary">
          {tr('admin.money.manualBody')}
        </Text>
        <Segmented
          value={target}
          onChange={(v) => {
            setTarget(v);
            setTargetId('');
          }}
          options={[
            { value: 'order', label: tr('admin.money.orderId') },
            { value: 'invoice', label: tr('admin.money.invoiceId') },
          ]}
        />
        <TextField
          key={`id-${formKey}`}
          label={target === 'order' ? tr('admin.money.orderId') : tr('admin.money.invoiceId')}
          placeholder={
            target === 'order' ? tr('admin.money.orderIdPlaceholder') : tr('admin.money.invoiceIdPlaceholder')
          }
          value={targetId}
          onChangeText={setTargetId}
          autoCapitalize="none"
          error={errors.target}
          icon={target === 'order' ? 'receipt' : 'invoice'}
        />
        <MoneyField
          key={`amt-${formKey}`}
          label={tr('admin.money.amount')}
          cents={amount}
          onChangeCents={setAmount}
          error={errors.amount}
          placeholder="0"
        />
        <View style={{ gap: 8 }}>
          <Text variant="calloutStrong">{tr('admin.money.method')}</Text>
          <RadioRow
            label={tr('admin.money.bank')}
            description={tr('admin.money.bankHint')}
            selected={method === 'BANK_TRANSFER'}
            onPress={() => setMethod('BANK_TRANSFER')}
          />
          <RadioRow
            label={tr('admin.money.cash')}
            description={tr('admin.money.cashHint')}
            selected={method === 'CASH'}
            onPress={() => setMethod('CASH')}
          />
        </View>
        <TextField
          key={`ref-${formKey}`}
          label={tr('admin.money.reference')}
          placeholder={tr('admin.money.referencePlaceholder')}
          value={reference}
          onChangeText={setReference}
          error={errors.reference}
          autoCapitalize="characters"
        />
        <MutationError error={manualPayment.error} />
        <Button
          label={tr('admin.money.record')}
          onPress={submit}
          loading={manualPayment.isPending}
          icon="check"
          size="md"
          fullWidth={size === 'compact'}
        />
      </Section>
    </View>
  );
}
