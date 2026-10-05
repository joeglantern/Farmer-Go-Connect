import { OrderStatus } from '@farmgo/contracts';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { dateShort, kes, produceName, qty, unitLabel } from '../../lib/format';
import { Chip } from '../../ui/Controls';
import { Text } from '../../ui/Text';
import { type Column, DataTable } from './DataTable';
import { type OrderFilters, type OrderRow, useAdminOrders } from './data';
import { StatusPill } from './ui';

const STATUSES = OrderStatus.options;

/**
 * Admin order table (APP_SPEC 56). The Orders tab belongs to the Lead, who mounts this and
 * passes `onRowPress` to open the order detail. Owns its scroll: place it in `Screen scroll={false}`.
 */
export function OrdersTable({
  filters: external,
  onRowPress,
  header,
  showStatusFilter = true,
}: {
  filters?: OrderFilters;
  onRowPress?: (order: OrderRow) => void;
  header?: ReactNode;
  showStatusFilter?: boolean;
}) {
  const { t: tr } = useTranslation();
  const [status, setStatus] = useState<string | undefined>(external?.status);
  const filters: OrderFilters = { ...external, status };
  const query = useAdminOrders(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<OrderRow>[] = [
    {
      key: 'code',
      title: tr('admin.orders.col.order'),
      flex: 1.5,
      primary: true,
      sort: (o) => o.code,
      render: (o) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numeric numberOfLines={1}>
            {o.code}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {o.buyerOrg.name}
          </Text>
        </View>
      ),
    },
    {
      key: 'farmer',
      title: tr('admin.orders.col.farmer'),
      flex: 1.2,
      sort: (o) => o.farmer.name.toLowerCase(),
      render: (o) => (
        <Text variant="callout" numberOfLines={1}>
          {o.farmer.name}
        </Text>
      ),
    },
    {
      key: 'items',
      title: tr('admin.orders.col.items'),
      flex: 1.6,
      hideBelow: 'expanded',
      render: (o) => (
        <Text variant="callout" numberOfLines={1}>
          {o.items
            .map(
              (it) =>
                `${qty(it.quantity)} ${unitLabel(it.listing.produce.unit, it.quantity)} ${produceName(it.listing.produce)}`,
            )
            .join(', ')}
        </Text>
      ),
    },
    {
      key: 'total',
      title: tr('admin.orders.col.total'),
      width: 120,
      align: 'right',
      sort: (o) => o.total,
      render: (o) => (
        <Text variant="calloutStrong" numeric>
          {kes(o.total)}
        </Text>
      ),
    },
    {
      key: 'delivery',
      title: tr('admin.orders.col.delivery'),
      width: 110,
      sort: (o) => o.deliveryDate,
      render: (o) => (
        <Text variant="callout" numeric>
          {dateShort(o.deliveryDate)}
        </Text>
      ),
    },
    {
      key: 'payment',
      title: tr('admin.orders.col.payment'),
      width: 130,
      hideBelow: 'expanded',
      sort: (o) => o.paymentStatus,
      render: (o) => <StatusPill status={o.paymentStatus} size="sm" />,
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 140,
      sort: (o) => o.status,
      render: (o) => <StatusPill status={o.status} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(o) => o.id}
      onRowPress={onRowPress}
      rowLabel={(o) => `${o.code}, ${o.buyerOrg.name}, ${kes(o.total)}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      defaultSort={{ key: 'delivery', dir: 'desc' }}
      empty={{ art: 'noOrders', title: tr('admin.orders.empty'), body: tr('admin.orders.emptyBody') }}
      header={
        <View style={{ gap: 10, paddingBottom: 12 }}>
          {header}
          {showStatusFilter && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={tr('admin.common.all')} selected={!status} onPress={() => setStatus(undefined)} />
              {STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={tr(`admin.status.${s}`)}
                  selected={status === s}
                  onPress={() => setStatus(status === s ? undefined : s)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      }
    />
  );
}
