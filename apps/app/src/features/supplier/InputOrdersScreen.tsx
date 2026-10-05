import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { kes, qty, timeAgo, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill, Segmented } from '../../ui/Controls';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { prettyPhone } from '../agent/data';
import { type InputOrderStatus, orderStatusView, useSupplierOrders } from './data';
import { InputOrderCard, OrderActions } from './InputOrderCard';

type Tab = 'new' | 'active' | 'done';
const TAB_STATUSES: Record<Tab, InputOrderStatus[]> = {
  new: ['PENDING'],
  active: ['ACCEPTED', 'DISPATCHED'],
  done: ['DELIVERED', 'REJECTED', 'CANCELLED'],
};

/** Orders for the supplier's products (also the supplier's Orders tab): accept, dispatch, mark delivered. Table on desktop. */
export function InputOrdersScreen({ inTab = false }: { inTab?: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const orders = useSupplierOrders();
  const [tab, setTab] = useState<Tab>('new');
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const all = orders.data ?? [];
    return {
      new: all.filter((o) => TAB_STATUSES.new.includes(o.status)).length,
      active: all.filter((o) => TAB_STATUSES.active.includes(o.status)).length,
    };
  }, [orders.data]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (orders.data ?? []).filter(
      (o) =>
        TAB_STATUSES[tab].includes(o.status) &&
        (!n || o.buyer.name.toLowerCase().includes(n) || o.product.name.toLowerCase().includes(n)),
    );
  }, [orders.data, tab, q]);
  const table = size === 'expanded';

  return (
    <Screen
      header={
        <Header title={tr('supplier.ordersTitle')} subtitle={tr('supplier.ordersSubtitle')} back={!inTab} />
      }
      refreshing={orders.isRefetching}
      onRefresh={() => void orders.refetch()}
    >
      <View style={{ gap: 16 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'new', label: tr('supplier.tabNew'), count: counts.new },
            { value: 'active', label: tr('supplier.tabActive'), count: counts.active },
            { value: 'done', label: tr('supplier.tabDone') },
          ]}
        />
        {(orders.data?.length ?? 0) > 0 && (
          <SearchField value={q} onChangeText={setQ} placeholder={tr('supplier.searchOrders')} />
        )}

        {orders.isLoading ? (
          <SkeletonList count={4} height={150} />
        ) : orders.error ? (
          <ErrorState onRetry={() => void orders.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            art="noOrders"
            title={q ? tr('supplier.noMatch') : tr(`supplier.empty.${tab}`)}
            body={q ? undefined : tr('supplier.emptyBody')}
            action={
              q
                ? { label: tr('agent.clearFilters'), onPress: () => setQ(''), icon: 'close' }
                : {
                    label: tr('supplier.viewProducts'),
                    onPress: () => router.push('/products'),
                    icon: 'storefront',
                  }
            }
          />
        ) : table ? (
          <Card padded={false}>
            <View style={[styles.tr, { borderBottomWidth: 1, borderBottomColor: t.colors.line }]}>
              {(
                [
                  ['buyer', 2.2, 'left'],
                  ['product', 2.4, 'left'],
                  ['qty', 1, 'right'],
                  ['total', 1.2, 'right'],
                  ['status', 1.4, 'left'],
                  ['actions', 2.8, 'right'],
                ] as const
              ).map(([k, flex, align]) => (
                <Text key={k} variant="micro" tone="tertiary" style={{ flex }} align={align}>
                  {tr(`supplier.col.${k}`).toUpperCase()}
                </Text>
              ))}
            </View>
            {list.map((o, i) => {
              const s = orderStatusView(o.status);
              return (
                <View
                  key={o.id}
                  style={[styles.tr, { borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.line }]}
                >
                  <View style={{ flex: 2.2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {o.buyer.name}
                    </Text>
                    <Text variant="caption" tone="tertiary" numeric numberOfLines={1}>
                      {[prettyPhone(o.buyer.phoneNumber), timeAgo(o.createdAt)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ flex: 2.4 }}>
                    <Text variant="body" numberOfLines={1}>
                      {o.product.name}
                    </Text>
                    {o.deliveryNote && (
                      <Text variant="caption" tone="tertiary" numberOfLines={1}>
                        {o.deliveryNote}
                      </Text>
                    )}
                  </View>
                  <Text variant="body" numeric style={{ flex: 1 }} align="right">
                    {qty(o.quantity)} {unitLabel(o.product.unit, o.quantity)}
                  </Text>
                  <Text variant="bodyStrong" numeric style={{ flex: 1.2 }} align="right">
                    {kes(o.total)}
                  </Text>
                  <View style={{ flex: 1.4, alignItems: 'flex-start' }}>
                    <Pill label={tr(`supplier.status.${o.status}`)} tone={s.tone} icon={s.icon} size="sm" />
                  </View>
                  <View style={{ flex: 2.8, alignItems: 'flex-end' }}>
                    <OrderActions order={o} compact />
                  </View>
                </View>
              );
            })}
          </Card>
        ) : (
          <View style={styles.grid}>
            {list.map((o) => (
              <View key={o.id} style={{ width: size === 'medium' ? '48.8%' : '100%' }}>
                <InputOrderCard order={o} />
              </View>
            ))}
          </View>
        )}
        {orders.hasNextPage && (
          <Button
            label={tr('agent.loadMore')}
            variant="outline"
            loading={orders.isFetchingNextPage}
            onPress={() => void orders.fetchNextPage()}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    minHeight: 64,
    paddingVertical: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
