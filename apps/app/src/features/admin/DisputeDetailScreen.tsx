import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, kes, produceName, qty, timeAgo, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { RadioRow } from '../../ui/Controls';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Skeleton } from '../../ui/Skeleton';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import {
  type AdminDisputeDetail,
  disputeSubject,
  type OrderDetail,
  useAdminDispute,
  useAdminMutations,
  useOrderDetail,
} from './data';
import {
  AdminPage,
  Columns,
  DetailState,
  Facts,
  goOrg,
  goUser,
  LinkRow,
  MoneyField,
  MutationError,
  Section,
  StatusPill,
} from './ui';

/** APP_SPEC screen 56: dispute resolution with or without a refund (produce and green-input orders). */
export function DisputeDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const dispute = useAdminDispute(id);
  const d = dispute.data;
  // Produce orders: load the full order for its items and QA record.
  const order = useOrderDetail(d?.order?.id);
  const [resolving, setResolving] = useState(false);
  const subject = d ? disputeSubject(d) : null;

  return (
    <AdminPage
      title={subject ? tr('admin.dispute.titleFor', { code: subject.code }) : tr('admin.dispute.title')}
      back
      refreshing={dispute.isRefetching}
      onRefresh={() => {
        void dispute.refetch();
        if (d?.order) void order.refetch();
      }}
    >
      {!d ? (
        <DetailState
          loading={dispute.isLoading}
          error={dispute.error}
          onRetry={() => dispute.refetch()}
          notFound={tr('admin.dispute.notFound')}
        />
      ) : (
        <>
          <Columns ratio={[1.2, 1]}>
            <View style={{ gap: 16 }}>
              <Complaint dispute={d} />
              {d.order ? (
                <OrderCard dispute={d} order={order.data} loading={order.isLoading} />
              ) : (
                <InputOrderCard dispute={d} />
              )}
            </View>
            <Actions dispute={d} onResolve={() => setResolving(true)} />
          </Columns>
          <ResolveSheet dispute={d} visible={resolving} onClose={() => setResolving(false)} />
        </>
      )}
    </AdminPage>
  );
}

function Complaint({ dispute: d }: { dispute: AdminDisputeDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const s = disputeSubject(d);
  return (
    <Section title={tr('admin.dispute.complaint')} action={<StatusPill status={d.status} />}>
      <Facts
        rows={[
          {
            label: tr('admin.dispute.reason'),
            value: tr(`admin.dispute.reasons.${d.reason}`, { defaultValue: d.reason }),
          },
          { label: tr('admin.dispute.raisedBy'), value: `${d.raisedBy.name} · ${s.party}` },
          { label: tr('admin.dispute.opened'), value: `${dateLong(d.createdAt)} (${timeAgo(d.createdAt)})` },
          { label: tr('admin.dispute.orderTotal'), value: kes(s.total), numeric: true },
        ]}
      />
      <View style={{ gap: 6 }}>
        <Text variant="calloutStrong">{tr('admin.dispute.description')}</Text>
        <Text variant="body">{d.description}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="calloutStrong">{tr('admin.dispute.photos')}</Text>
        {d.photoUrls.length === 0 ? (
          <Text variant="callout" tone="secondary">
            {tr('admin.dispute.noPhotos')}
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {d.photoUrls.map((url, i) => (
              <View
                key={url}
                style={{
                  width: 160,
                  height: 120,
                  borderRadius: t.radius.sm,
                  overflow: 'hidden',
                  backgroundColor: t.colors.surfaceMuted,
                }}
                accessibilityRole="image"
                accessibilityLabel={tr('admin.dispute.photoN', { n: i + 1 })}
              >
                <Image
                  source={{ uri: url }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  transition={150}
                />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      {d.status.startsWith('RESOLVED') && (
        <Banner
          tone={d.status === 'RESOLVED_REFUND' ? 'success' : 'info'}
          title={
            d.status === 'RESOLVED_REFUND'
              ? tr('admin.dispute.refunded', { amount: kes(d.refundAmount ?? 0) })
              : tr('admin.dispute.closedNoRefund')
          }
          message={[
            d.resolution,
            d.resolvedBy ? tr('admin.dispute.resolvedBy', { name: d.resolvedBy.name }) : null,
            d.resolvedAt ? dateLong(d.resolvedAt) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      )}
    </Section>
  );
}

function OrderCard({
  dispute: d,
  order,
  loading,
}: {
  dispute: AdminDisputeDetail;
  order?: OrderDetail;
  loading: boolean;
}) {
  const { t: tr } = useTranslation();
  const o = d.order!;
  return (
    <Section title={tr('admin.dispute.order', { code: o.code })} action={<StatusPill status={o.status} />}>
      <Facts
        rows={[
          { label: tr('admin.dispute.buyer'), value: o.buyerOrg.name },
          { label: tr('admin.dispute.farmer'), value: o.farmer.name },
          {
            label: tr('admin.dispute.delivered'),
            value: order?.deliveredAt ? dateLong(order.deliveredAt) : tr('admin.common.notSet'),
          },
          {
            label: tr('admin.dispute.paymentStatus'),
            value: <StatusPill status={o.paymentStatus} size="sm" />,
          },
          {
            label: tr('admin.dispute.subtotal'),
            value: order ? kes(order.acceptedSubtotal ?? order.subtotal) : tr('admin.common.notSet'),
            numeric: true,
          },
          { label: tr('admin.dispute.total'), value: kes(o.total), numeric: true },
        ]}
      />
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.dispute.items')}</Text>
        {loading && !order ? (
          <Skeleton height={36} />
        ) : !order ? (
          <Text variant="callout" tone="secondary">
            {tr('admin.dispute.orderUnavailable')}
          </Text>
        ) : (
          order.items.map((it) => (
            <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
              <Text variant="callout" style={{ flex: 1 }} numberOfLines={1}>
                {produceName(it.listing.produce)} · {qty(it.quantity)}{' '}
                {unitLabel(it.listing.produce.unit, it.quantity)}
                {it.inspection
                  ? ` · ${tr('admin.dispute.qaAccepted', { qty: qty(it.inspection.acceptedQty) })}`
                  : ''}
              </Text>
              <Text variant="callout" numeric>
                {kes(it.lineTotal)}
              </Text>
            </View>
          ))
        )}
      </View>
      <LinkRow
        label={tr('admin.dispute.viewFarmer')}
        hint={o.farmer.name}
        onPress={() => goUser(o.farmer.id)}
        icon="user"
      />
      <LinkRow
        label={tr('admin.dispute.viewBuyer')}
        hint={o.buyerOrg.name}
        onPress={() => goOrg(o.buyerOrg.id)}
        icon="building"
      />
    </Section>
  );
}

function InputOrderCard({ dispute: d }: { dispute: AdminDisputeDetail }) {
  const { t: tr } = useTranslation();
  const io = d.inputOrder;
  if (!io) {
    return (
      <Section title={tr('admin.dispute.inputOrder')}>
        <Text variant="callout" tone="secondary">
          {tr('admin.dispute.orderUnavailable')}
        </Text>
      </Section>
    );
  }
  return (
    <Section title={tr('admin.dispute.inputOrder')} action={<StatusPill status={io.status} />}>
      <Facts
        rows={[
          { label: tr('admin.dispute.product'), value: io.product.name },
          { label: tr('admin.dispute.supplier'), value: io.product.supplierOrg.name },
          { label: tr('admin.dispute.buyer'), value: io.buyer.name },
          {
            label: tr('admin.dispute.paymentStatus'),
            value: <StatusPill status={io.paymentStatus} size="sm" />,
          },
          { label: tr('admin.dispute.total'), value: kes(io.total), numeric: true },
        ]}
      />
      <LinkRow
        label={tr('admin.dispute.viewBuyerUser')}
        hint={io.buyer.name}
        onPress={() => goUser(io.buyer.id)}
        icon="user"
      />
      <LinkRow
        label={tr('admin.dispute.viewSupplier')}
        hint={io.product.supplierOrg.name}
        onPress={() => goOrg(io.product.supplierOrg.id)}
        icon="building"
      />
    </Section>
  );
}

function Actions({ dispute: d, onResolve }: { dispute: AdminDisputeDetail; onResolve: () => void }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { reviewDispute } = useAdminMutations();
  const open = d.status === 'OPEN' || d.status === 'UNDER_REVIEW';

  const review = async () => {
    const ok = await dialog.confirm({
      title: tr('admin.dispute.markReviewConfirm'),
      message: tr('admin.dispute.markReviewBody', { buyer: disputeSubject(d).party }),
      confirmLabel: tr('admin.dispute.markReview'),
      icon: 'eye',
    });
    if (!ok) return;
    try {
      await reviewDispute.mutateAsync({ id: d.id });
      toast.success(tr('admin.dispute.reviewed'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Section title={tr('admin.dispute.actions')}>
      {!open ? (
        <Text variant="callout" tone="secondary">
          {tr('admin.dispute.alreadyResolved')}
        </Text>
      ) : (
        <>
          <Text variant="callout" tone="secondary">
            {tr('admin.dispute.actionsBody')}
          </Text>
          {d.status === 'OPEN' && (
            <Button
              label={tr('admin.dispute.markReview')}
              icon="eye"
              variant="secondary"
              size="md"
              onPress={review}
              loading={reviewDispute.isPending}
            />
          )}
          <Button label={tr('admin.dispute.resolve')} icon="check" size="md" onPress={onResolve} />
          <MutationError error={reviewDispute.error} />
        </>
      )}
      {d.order && (
        <Button
          label={tr('admin.dispute.viewOrder')}
          icon="orders"
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={() => router.push({ pathname: '/order/[id]', params: { id: d.order!.id } })}
        />
      )}
    </Section>
  );
}

function ResolveSheet({
  dispute: d,
  visible,
  onClose,
}: {
  dispute: AdminDisputeDetail;
  visible: boolean;
  onClose: () => void;
}) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { resolveDispute } = useAdminMutations();
  const s = disputeSubject(d);
  const input = s.kind === 'input';
  const max = s.total;
  const [outcome, setOutcome] = useState<'REFUND' | 'NO_REFUND'>('REFUND');
  const [amount, setAmount] = useState<number | null>(max);
  const [resolution, setResolution] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; resolution?: string }>({});

  const submit = async () => {
    const e: typeof errors = {};
    if (outcome === 'REFUND' && (!amount || amount <= 0 || amount > max))
      e.amount = tr('admin.dispute.refundInvalid', { max: kes(max) });
    if (resolution.trim().length < 3) e.resolution = tr('admin.dispute.resolutionInvalid');
    setErrors(e);
    if (e.amount || e.resolution) return;
    const refundBody = input
      ? 'admin.dispute.resolveConfirmRefundInputBody'
      : 'admin.dispute.resolveConfirmRefundBody';
    const noRefundBody = input
      ? 'admin.dispute.resolveConfirmNoRefundInputBody'
      : 'admin.dispute.resolveConfirmNoRefundBody';
    const ok = await dialog.confirm({
      title:
        outcome === 'REFUND'
          ? tr('admin.dispute.resolveConfirmRefund', { amount: kes(amount!), buyer: s.party })
          : tr('admin.dispute.resolveConfirmNoRefund'),
      message: tr(outcome === 'REFUND' ? refundBody : noRefundBody, { code: s.code }),
      confirmLabel: outcome === 'REFUND' ? tr('admin.dispute.refund') : tr('admin.dispute.noRefund'),
      destructive: outcome === 'REFUND',
      icon: outcome === 'REFUND' ? 'money' : 'check',
    });
    if (!ok) return;
    try {
      await resolveDispute.mutateAsync({
        id: d.id,
        outcome,
        refundAmount: outcome === 'REFUND' ? amount! : undefined,
        resolution: resolution.trim(),
      });
      toast.success(
        outcome === 'REFUND'
          ? tr('admin.dispute.resolvedRefund', { amount: kes(amount!) })
          : tr('admin.dispute.resolvedNoRefund'),
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
      title={tr('admin.dispute.resolve')}
      subtitle={tr('admin.dispute.resolveBody', { code: s.code })}
      dismissible={!resolveDispute.isPending}
      footer={
        <Button
          label={
            outcome === 'REFUND'
              ? tr('admin.dispute.refundAction', { amount: kes(amount ?? 0) })
              : tr('admin.dispute.closeNoRefund')
          }
          variant={outcome === 'REFUND' ? 'danger' : 'primary'}
          onPress={submit}
          loading={resolveDispute.isPending}
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Text variant="calloutStrong">{tr('admin.dispute.outcome')}</Text>
        <RadioRow
          label={tr('admin.dispute.refund')}
          description={input ? tr('admin.dispute.refundInputHint') : tr('admin.dispute.refundHint')}
          selected={outcome === 'REFUND'}
          onPress={() => setOutcome('REFUND')}
        />
        <RadioRow
          label={tr('admin.dispute.noRefund')}
          description={input ? tr('admin.dispute.noRefundInputHint') : tr('admin.dispute.noRefundHint')}
          selected={outcome === 'NO_REFUND'}
          onPress={() => setOutcome('NO_REFUND')}
        />
      </View>
      {outcome === 'REFUND' && (
        <MoneyField
          label={tr('admin.dispute.refundAmount')}
          cents={amount}
          onChangeCents={setAmount}
          hint={tr('admin.dispute.refundMax', { max: kes(max) })}
          error={errors.amount}
        />
      )}
      <TextField
        label={tr('admin.dispute.resolution')}
        placeholder={tr('admin.dispute.resolutionPlaceholder')}
        value={resolution}
        onChangeText={setResolution}
        error={errors.resolution}
        multiline
        numberOfLines={3}
      />
      <MutationError error={resolveDispute.error} />
    </Sheet>
  );
}
