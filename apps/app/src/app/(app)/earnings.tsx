import type { PayoutListItemDto } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { StatTile } from '../../features/farmer/components';
import { usePayouts } from '../../features/farmer/data';
import { EarningsChart } from '../../features/farmer/EarningsChart';
import { api } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { dateShort, kes, timeShort } from '../../lib/format';
import { useRole } from '../../nav/Shell';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

/** Earnings: M-Pesa payouts for farmers, delivered input sales for youth enterprises. */
export default function Earnings() {
  const role = useRole();
  return <EarningsView as={role === 'input_supplier' ? 'supplier' : 'farmer'} />;
}

/** One screen for both: the summary comes from GET /v1/payouts (B26), `as=supplier` for input sales. */
function EarningsView({ as }: { as: 'farmer' | 'supplier' }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const payouts = usePayouts(as);
  const [filter, setFilter] = useState<'all' | 'SUCCESS' | 'PENDING' | 'FAILED'>('all');
  const [editOpen, setEditOpen] = useState(false);
  const first = payouts.data?.pages[0];
  const items = useMemo(() => {
    const all = payouts.data?.pages.flatMap((p) => p.items) ?? [];
    return filter === 'all'
      ? all
      : all.filter((p) =>
          filter === 'PENDING'
            ? p.status === 'PENDING'
            : filter === 'FAILED'
              ? ['FAILED', 'CANCELLED', 'TIMEOUT'].includes(p.status)
              : p.status === filter,
        );
  }, [payouts.data, filter]);
  const failed = (payouts.data?.pages.flatMap((p) => p.items) ?? []).some((p) =>
    ['FAILED', 'CANCELLED', 'TIMEOUT'].includes(p.status),
  );
  const mpesa = me?.farmerProfile?.mpesaNumber;
  const gutter = size === 'compact' ? 20 : 32;

  const header = (
    <View style={{ gap: 14, paddingBottom: 8 }}>
      <View style={styles.row}>
        <StatTile
          label={tr('farmer.thisMonth')}
          value={first ? kes(first.paidThisMonthCents) : null}
          icon="calendar"
          hint={first ? tr('earnings.allTime', { amount: kes(first.totalPaidCents) }) : undefined}
        />
        <StatTile
          label={tr('earnings.sending')}
          value={first ? kes(first.pendingCents) : null}
          icon="clock"
          hint={tr('earnings.sendingHint')}
        />
        <StatTile
          label={tr('earnings.held')}
          value={first ? kes(first.heldCents) : null}
          icon="shield"
          hint={tr('earnings.heldHint')}
        />
      </View>
      <EarningsChart as={as} />
      {as === 'farmer' && (
        <Pressable
          onPress={() => setEditOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={tr('earnings.paidTo', { number: mpesa ?? '' })}
          focusRadius={t.radius.md}
          style={({ pressed }) => [
            styles.mpesa,
            {
              borderRadius: t.radius.md,
              borderColor: t.colors.line,
              backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
            },
          ]}
        >
          <View style={[styles.round, { backgroundColor: t.colors.primaryTint }]}>
            <Icon name="phone" size={20} color={t.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="secondary">
              {tr('earnings.paidToLabel')}
            </Text>
            <Text variant="bodyStrong" numeric>
              {mpesa ?? tr('earnings.noNumber')}
            </Text>
          </View>
          <Text variant="calloutStrong" tone="brand">
            {tr('common.edit')}
          </Text>
        </Pressable>
      )}
      {failed && <Banner tone="warning" message={tr('earnings.failedNote')} />}
      <Text variant="caption" tone="tertiary">
        {as === 'supplier' ? tr('earnings.supplierNote') : tr('earnings.howPaid')}
      </Text>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: tr('earnings.all') },
          { value: 'SUCCESS', label: tr('earnings.paid') },
          { value: 'PENDING', label: tr('earnings.processing') },
          { value: 'FAILED', label: tr('earnings.failed') },
        ]}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('nav.earnings')} large={size === 'compact'} />
      {payouts.isLoading ? (
        <View style={{ padding: gutter }}>
          <SkeletonList count={5} height={72} />
        </View>
      ) : payouts.error ? (
        <ErrorState onRetry={() => payouts.refetch()} message={humanError(payouts.error)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={header}
          contentContainerStyle={{
            padding: gutter,
            paddingTop: 4,
            gap: 10,
            maxWidth: 860,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={payouts.isRefetching}
          onRefresh={() => payouts.refetch()}
          onEndReached={() => payouts.hasNextPage && !payouts.isFetchingNextPage && payouts.fetchNextPage()}
          renderItem={({ item }) => <PayoutRow p={item} />}
          ListEmptyComponent={
            <EmptyState
              compact
              art="noResults"
              title={tr('earnings.emptyTitle')}
              body={as === 'supplier' ? tr('earnings.supplierEmpty') : tr('earnings.emptyBody')}
            />
          }
        />
      )}
      <MpesaSheet visible={editOpen} onClose={() => setEditOpen(false)} current={mpesa ?? null} />
    </View>
  );
}

/** Change the M-Pesa number payouts go to (PATCH /v1/me/farmer-profile). */
function MpesaSheet({
  visible,
  onClose,
  current,
}: {
  visible: boolean;
  onClose: () => void;
  current: string | null;
}) {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const refreshMe = useSession((s) => s.refreshMe);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) {
      setPhone(current ? toLocalDigits(current) : '');
      setError(null);
    }
  }, [visible, current]);
  const save = async () => {
    const msisdn = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (!msisdn) return setError(tr('auth.errors.phone'));
    setBusy(true);
    try {
      await api.patch('/v1/me/farmer-profile', { mpesaNumber: msisdn });
      await refreshMe();
      toast.success(tr('earnings.numberSaved'));
      onClose();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('earnings.changeNumber')}
      subtitle={tr('earnings.changeNumberBody')}
      footer={<Button label={tr('common.save')} onPress={save} loading={busy} />}
    >
      <PhoneField
        label={tr('checkout.mpesaNumber')}
        value={phone}
        onChangeText={(v) => {
          setPhone(v.replace(/[^\d ]/g, ''));
          setError(null);
        }}
        error={error}
      />
    </Sheet>
  );
}

function PayoutRow({ p }: { p: PayoutListItemDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const tone = p.status === 'SUCCESS' ? 'success' : p.status === 'PENDING' ? 'info' : 'danger';
  const label =
    p.status === 'SUCCESS'
      ? tr('earnings.paid')
      : p.status === 'PENDING'
        ? tr('earnings.processing')
        : tr('earnings.failed');
  const code = p.order?.code ?? tr('earnings.inputSale');
  const orderId = p.order?.id;
  return (
    <Card
      onPress={orderId ? () => router.push({ pathname: '/order/[id]', params: { id: orderId } }) : undefined}
      accessibilityLabel={`${code}, ${kes(p.amount)}, ${label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <View
        style={[
          styles.round,
          {
            backgroundColor:
              tone === 'success'
                ? t.colors.successTint
                : tone === 'info'
                  ? t.colors.infoTint
                  : t.colors.dangerTint,
          },
        ]}
      >
        <Icon
          name={tone === 'success' ? 'checkCircle' : tone === 'info' ? 'clock' : 'warning'}
          size={20}
          color={tone === 'success' ? t.colors.success : tone === 'info' ? t.colors.info : t.colors.danger}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numeric>
          {code}
        </Text>
        <Text variant="caption" tone="secondary" numeric numberOfLines={1}>
          {dateShort(p.createdAt)}, {timeShort(p.createdAt)}
          {p.mpesaReceipt ? ` · ${p.mpesaReceipt}` : ''}
        </Text>
        <Text variant="caption" tone="tertiary" numeric>
          {tr('earnings.breakdown', { gross: kes(p.grossAmount), fee: kes(p.commission) })}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="headline" numeric>
          {kes(p.amount)}
        </Text>
        <Pill label={label} tone={tone} size="sm" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  mpesa: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
