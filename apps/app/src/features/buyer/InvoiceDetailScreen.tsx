import type { PaymentDetailDto } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { api } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { dateLong, dateShort, kes, timeAgo } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Divider } from '../../ui/Controls';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Header, Screen, SectionTitle } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { type InvoiceDetail, useInvoice, usePayInvoice } from './data';
import { StatusTag } from './StatusTag';

export function InvoiceDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const inv = useInvoice(id);
  const d = inv.data;
  return (
    <Screen
      header={<Header title={d ? tr('invoices.titleFor', { number: d.number }) : tr('invoices.title')} />}
      refreshing={inv.isRefetching}
      onRefresh={() => inv.refetch()}
      maxWidth={880}
    >
      {inv.isLoading ? (
        <View style={{ gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={tr('common.loading')}>
          <Skeleton height={160} radius={14} />
          <Skeleton height={200} radius={14} />
        </View>
      ) : inv.error || !d ? (
        <ErrorState
          message={
            (inv.error as { status?: number } | null)?.status === 404
              ? tr('invoices.notFound')
              : humanError(inv.error)
          }
          onRetry={() => inv.refetch()}
        />
      ) : (
        <Body inv={d} />
      )}
    </Screen>
  );
}

function Body({ inv }: { inv: InvoiceDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const [paying, setPaying] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const balance = Math.max(0, inv.total - inv.amountPaid);
  const payable = balance > 0 && ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status);

  const summary = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="title3" numeric style={{ flex: 1 }}>
          {inv.number}
        </Text>
        <StatusTag status={inv.status} />
      </View>
      <Text variant="callout" tone="secondary">
        {tr('invoices.period', { from: dateShort(inv.periodStart), to: dateShort(inv.periodEnd) })}
        {inv.dueAt ? ` · ${tr('invoices.dueOn', { date: dateLong(inv.dueAt) })}` : ''}
      </Text>
      {inv.status === 'OVERDUE' && <Banner tone="danger" message={tr('invoices.overdue')} />}
      <Divider />
      <Line label={tr('invoices.subtotal')} value={kes(inv.subtotal)} />
      <Line label={tr('invoices.total')} value={kes(inv.total)} strong />
      <Line label={tr('invoices.paid')} value={kes(inv.amountPaid)} />
      <Line label={tr('invoices.balance')} value={kes(balance)} strong />
      {payable && (
        <Button
          label={tr('invoices.pay', { amount: kes(balance) })}
          icon="phone"
          onPress={() => setPaying(true)}
        />
      )}
      {paymentId && <PaymentStatus paymentId={paymentId} />}
    </Card>
  );

  const orders = (
    <View>
      <SectionTitle title={tr('invoices.ordersTitle')} />
      <ListGroup>
        {inv.orders.map((o) => (
          <ListRow
            key={o.id}
            icon="orders"
            label={o.code}
            detail={dateShort(o.deliveryDate)}
            value={kes(o.total)}
            onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
          />
        ))}
      </ListGroup>
    </View>
  );

  const payments = (
    <View>
      <SectionTitle title={tr('invoices.paymentsTitle')} />
      {inv.payments.length === 0 ? (
        <Text variant="callout" tone="secondary">
          {tr('invoices.noPayments')}
        </Text>
      ) : (
        <ListGroup>
          {inv.payments.map((p) => (
            <ListRow
              key={p.id}
              icon="wallet"
              label={kes(p.amount)}
              detail={[
                tr(`invoices.method.${p.method}`, { defaultValue: p.method }),
                p.mpesaReceipt,
                timeAgo(p.createdAt),
              ]
                .filter(Boolean)
                .join(' · ')}
              value={tr(`invoices.tx.${p.status}`, { defaultValue: p.status })}
            />
          ))}
        </ListGroup>
      )}
    </View>
  );

  return (
    <>
      {size === 'compact' ? (
        <View style={{ gap: 8, paddingTop: 4 }}>
          {summary}
          {orders}
          {payments}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 4 }}>
          <View style={{ flex: 1 }}>{summary}</View>
          <View style={{ flex: 1, gap: 8 }}>
            {orders}
            {payments}
          </View>
        </View>
      )}
      <PaySheet
        inv={inv}
        amount={balance}
        visible={paying}
        onClose={() => setPaying(false)}
        onStarted={(pid) => {
          setPaymentId(pid);
          setPaying(false);
        }}
      />
      <View style={{ height: 1, backgroundColor: t.colors.bg }} />
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'price' : 'body'} numeric>
        {value}
      </Text>
    </View>
  );
}

function PaySheet({
  inv,
  amount,
  visible,
  onClose,
  onStarted,
}: {
  inv: InvoiceDetail;
  amount: number;
  visible: boolean;
  onClose: () => void;
  onStarted: (paymentId: string) => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const pay = usePayInvoice();
  const [phone, setPhone] = useState(me?.user.phoneNumber ? toLocalDigits(me.user.phoneNumber) : '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const normalized = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (!normalized) return setError(tr('auth.errors.phone'));
    setError(null);
    const ok = await dialog.confirm({
      title: tr('invoices.payConfirm', { amount: kes(amount), number: inv.number }),
      message: tr('invoices.payConfirmBody', { phone: normalized }),
      confirmLabel: tr('invoices.sendPrompt'),
      icon: 'phone',
    });
    if (!ok) return;
    try {
      const res = await pay.mutateAsync({ id: inv.id, phoneNumber: normalized });
      toast.success(tr('invoices.promptSent'));
      onStarted(res.paymentId);
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('invoices.payTitle')}
      subtitle={tr('invoices.payBody', { amount: kes(amount) })}
      footer={<Button label={tr('invoices.sendPrompt')} onPress={submit} loading={pay.isPending} />}
    >
      <PhoneField
        label={tr('checkout.mpesaNumber')}
        placeholder={tr('auth.phonePlaceholder')}
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))}
        error={error}
      />
    </Sheet>
  );
}

/** Polls the payment after an STK push until it settles. */
function PaymentStatus({ paymentId }: { paymentId: string }) {
  const { t: tr } = useTranslation();
  const q = useQuery({
    queryKey: ['payments', paymentId],
    queryFn: () => api.get<PaymentDetailDto>(`/v1/payments/${paymentId}`),
    refetchInterval: (query) => (query.state.data && query.state.data.status !== 'PENDING' ? false : 3000),
  });
  const s = q.data?.status ?? 'PENDING';
  if (s === 'PENDING')
    return <Banner tone="info" title={tr('payment.checkPhone')} message={tr('invoices.waiting')} />;
  if (s === 'SUCCESS')
    return <Banner tone="success" title={tr('payment.paidTitle')} message={tr('invoices.paidBody')} />;
  return (
    <Banner
      tone="danger"
      title={tr('payment.failedTitle')}
      message={q.data?.resultDesc ?? tr('invoices.failedBody')}
    />
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
