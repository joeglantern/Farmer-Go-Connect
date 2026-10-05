import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import i18n from '../../i18n';
import { humanError } from '../../lib/errors';
import { dateShort, kes } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Card } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { type InvoiceRow, useBuyerDashboard, useInvoices } from './data';
import { StatusTag } from './StatusTag';

/** Weekly invoices for credit-terms buyers. */
export function InvoicesScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const list = useInvoices();
  const dash = useBuyerDashboard();
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const due = dash.data?.invoicesDue;
  const gutter = size === 'compact' ? 20 : 32;
  const wide = size !== 'compact';

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('invoices.title')} subtitle={tr('invoices.subtitle')} />
      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 32,
          width: '100%',
          maxWidth: 880,
          alignSelf: 'center',
        }}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => {
          void list.refetch();
          void dash.refetch();
        }}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ItemSeparatorComponent={() => <View style={{ height: wide ? 0 : 10 }} />}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 12 }}>
            {due && due.count > 0 && (
              <Card
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  backgroundColor: t.colors.warningTint,
                }}
                elevated={false}
              >
                <Icon name="invoice" size={24} color={t.colors.warning} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline">{tr('invoices.dueTitle', { count: due.count })}</Text>
                  <Text variant="callout" tone="secondary">
                    {tr('invoices.dueBody')}
                  </Text>
                </View>
                <Text variant="priceLarge" numeric>
                  {kes(due.amountCents)}
                </Text>
              </Card>
            )}
            {wide && rows.length > 0 && (
              <View style={[styles.row, { borderBottomColor: t.colors.lineStrong }]}>
                {['number', 'period', 'orders', 'total', 'balance', 'status'].map((k) => (
                  <Text
                    key={k}
                    variant="micro"
                    tone="tertiary"
                    style={[cell(k), { textTransform: 'uppercase' }]}
                  >
                    {tr(`invoices.col.${k}`)}
                  </Text>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (wide ? <InvoiceLine inv={item} /> : <InvoiceCard inv={item} />)}
        ListEmptyComponent={
          list.isLoading ? (
            <SkeletonList count={4} height={88} />
          ) : list.error ? (
            <ErrorState message={humanError(list.error)} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState art="noOrders" title={tr('invoices.emptyTitle')} body={tr('invoices.emptyBody')} />
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} /> : null}
      />
    </View>
  );
}

const cell = (k: string) =>
  k === 'number'
    ? { flex: 1.3 }
    : k === 'period'
      ? { flex: 1.6 }
      : k === 'status'
        ? { width: 120 }
        : { flex: 1 };
const open = (id: string) => router.push({ pathname: '/invoices/[id]', params: { id } });
const period = (i: InvoiceRow) =>
  i18n.t('invoices.period', { from: dateShort(i.periodStart), to: dateShort(i.periodEnd) });

function InvoiceLine({ inv }: { inv: InvoiceRow }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <Pressable
      onPress={() => open(inv.id)}
      accessibilityLabel={tr('invoices.rowLabel', { number: inv.number, total: kes(inv.total) })}
      focusRadius={6}
      style={({ hovered, pressed }) => [
        styles.row,
        {
          borderBottomColor: t.colors.line,
          backgroundColor: hovered || pressed ? t.colors.surfaceMuted : 'transparent',
        },
      ]}
    >
      <Text variant="bodyStrong" numeric style={cell('number')}>
        {inv.number}
      </Text>
      <Text variant="callout" style={cell('period')}>
        {period(inv)}
      </Text>
      <Text variant="callout" numeric style={cell('orders')}>
        {inv._count.orders}
      </Text>
      <Text variant="callout" numeric style={cell('total')}>
        {kes(inv.total)}
      </Text>
      <Text variant="calloutStrong" numeric style={cell('balance')}>
        {kes(Math.max(0, inv.total - inv.amountPaid))}
      </Text>
      <View style={cell('status')}>
        <StatusTag status={inv.status} />
      </View>
    </Pressable>
  );
}

function InvoiceCard({ inv }: { inv: InvoiceRow }) {
  const { t: tr } = useTranslation();
  const balance = Math.max(0, inv.total - inv.amountPaid);
  return (
    <Card
      onPress={() => open(inv.id)}
      accessibilityLabel={tr('invoices.rowLabel', { number: inv.number, total: kes(inv.total) })}
      style={{ gap: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="headline" numeric style={{ flex: 1 }}>
          {inv.number}
        </Text>
        <StatusTag status={inv.status} />
      </View>
      <Text variant="caption" tone="secondary">
        {period(inv)} · {tr('invoices.orders', { count: inv._count.orders })}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text variant="callout" tone="secondary">
          {inv.dueAt ? tr('invoices.dueOn', { date: dateShort(inv.dueAt) }) : ' '}
        </Text>
        <Text variant="price" numeric>
          {kes(balance > 0 ? balance : inv.total)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
});
