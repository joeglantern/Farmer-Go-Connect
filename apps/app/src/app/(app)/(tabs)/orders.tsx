import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useOrders } from '../../../data/orders';
import { OrderCard } from '../../../features/orders/OrderCard';
import { OrderDetail } from '../../../features/orders/OrderDetail';
import { InputOrdersScreen } from '../../../features/supplier/InputOrdersScreen';
import { useRole } from '../../../nav/Shell';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Segmented } from '../../../ui/Controls';
import { Header } from '../../../ui/Screen';
import { SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { SearchField } from '../../../ui/TextField';

/** Suppliers sell inputs, not produce, so their Orders tab is the input order list. */
export default function OrdersTab() {
  const role = useRole();
  return role === 'input_supplier' ? <InputOrdersScreen inTab /> : <Orders />;
}

/** Orders: Active and Past. On tablets and desktop, list and detail side by side. */
function Orders() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const role = useRole();
  const [scope, setScope] = useState<'active' | 'past'>('active');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useOrders(scope);
  const perspective =
    role === 'farmer' || role === 'agent'
      ? 'farmer'
      : role === 'buyer' || role === 'user'
        ? 'buyer'
        : 'staff';
  const split = size !== 'compact';

  const items = useMemo(() => {
    const all = orders.data?.pages.flatMap((p) => p.items) ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (o) =>
        o.code.toLowerCase().includes(needle) ||
        o.buyerOrg.name.toLowerCase().includes(needle) ||
        o.items.some(
          (i) =>
            i.listing.produce.name.toLowerCase().includes(needle) ||
            i.listing.produce.nameSw.toLowerCase().includes(needle),
        ),
    );
  }, [orders.data, q]);

  const current = split ? (selected ?? items[0]?.id ?? null) : null;

  const list = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, gap: 12, paddingBottom: 12 }}>
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSelected(null);
          }}
          options={[
            { value: 'active', label: tr('orders.active') },
            { value: 'past', label: tr('orders.past') },
          ]}
        />
        <SearchField value={q} onChangeText={setQ} placeholder={tr('orders.search')} />
      </View>
      {orders.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <SkeletonList count={5} height={84} />
        </View>
      ) : orders.error ? (
        <ErrorState onRetry={() => orders.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 10 }}
          refreshing={orders.isRefetching}
          onRefresh={() => orders.refetch()}
          onEndReached={() => orders.hasNextPage && !orders.isFetchingNextPage && orders.fetchNextPage()}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              perspective={perspective}
              selected={item.id === current}
              onPress={() =>
                split
                  ? setSelected(item.id)
                  : router.push({ pathname: '/order/[id]', params: { id: item.id } })
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              art="noOrders"
              title={
                q
                  ? tr('orders.noMatch')
                  : scope === 'active'
                    ? tr('orders.emptyActiveTitle')
                    : tr('orders.emptyPastTitle')
              }
              body={
                q
                  ? undefined
                  : perspective === 'farmer'
                    ? tr('orders.emptyFarmerBody')
                    : tr('orders.emptyBuyerBody')
              }
              action={
                q || scope === 'past'
                  ? undefined
                  : perspective === 'farmer'
                    ? {
                        label: tr('orders.listProduce'),
                        icon: 'plus',
                        onPress: () => router.navigate('/sell'),
                      }
                    : perspective === 'buyer'
                      ? { label: tr('cart.browse'), icon: 'basket', onPress: () => router.navigate('/home') }
                      : undefined
              }
            />
          }
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('tabs.orders')} back={false} large={!split} />
      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: size === 'expanded' ? 420 : 340,
              borderRightWidth: 1,
              borderRightColor: t.colors.line,
            }}
          >
            {list}
          </View>
          <View style={{ flex: 1 }}>
            {current ? (
              <OrderDetail id={current} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="callout" tone="tertiary">
                  {tr('orders.pick')}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </View>
  );
}
