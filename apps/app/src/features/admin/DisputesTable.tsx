import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { kes, timeAgo } from '../../lib/format';
import { Chip } from '../../ui/Controls';
import { Text } from '../../ui/Text';
import { type Column, DataTable } from './DataTable';
import { type AdminDisputeRow, disputeSubject, useAdminDisputes } from './data';
import { goDispute, StatusPill } from './ui';

/**
 * Disputes queue (APP_SPEC 56). Lives on the Money tab and is exported so the Lead can also
 * mount it on the Orders tab.
 */
export function DisputesTable({
  onRowPress = (d) => goDispute(d.id),
}: {
  onRowPress?: (d: AdminDisputeRow) => void;
}) {
  const { t: tr } = useTranslation();
  const [openOnly, setOpenOnly] = useState(true);
  const query = useAdminDisputes(openOnly);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<AdminDisputeRow>[] = [
    {
      key: 'order',
      title: tr('admin.money.col.order'),
      flex: 2,
      primary: true,
      sort: (d) => disputeSubject(d).code,
      render: (d) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1} numeric>
            {disputeSubject(d).code}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {disputeSubject(d).kind === 'input'
              ? tr('admin.dispute.inputFor', { name: disputeSubject(d).party })
              : disputeSubject(d).party}
          </Text>
        </View>
      ),
    },
    {
      key: 'reason',
      title: tr('admin.money.col.reason'),
      sort: (d) => d.reason,
      render: (d) => (
        <Text variant="callout">{tr(`admin.dispute.reasons.${d.reason}`, { defaultValue: d.reason })}</Text>
      ),
    },
    {
      key: 'raisedBy',
      title: tr('admin.money.col.raisedBy'),
      hideBelow: 'expanded',
      render: (d) => (
        <Text variant="callout" numberOfLines={1}>
          {d.raisedBy.name}
        </Text>
      ),
    },
    {
      key: 'total',
      title: tr('admin.money.col.amount'),
      width: 120,
      align: 'right',
      sort: (d) => disputeSubject(d).total,
      render: (d) => (
        <Text variant="callout" numeric>
          {kes(disputeSubject(d).total)}
        </Text>
      ),
    },
    {
      key: 'opened',
      title: tr('admin.money.col.opened'),
      width: 110,
      sort: (d) => d.createdAt,
      render: (d) => <Text variant="callout">{timeAgo(d.createdAt)}</Text>,
    },
    {
      key: 'status',
      title: tr('admin.people.col.status'),
      width: 140,
      render: (d) => <StatusPill status={d.status} size="sm" />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      keyOf={(d) => d.id}
      onRowPress={onRowPress}
      rowLabel={(d) => `${disputeSubject(d).code}, ${disputeSubject(d).party}`}
      loading={query.isLoading}
      error={query.error}
      onRetry={() => query.refetch()}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={() => query.refetch()}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      defaultSort={{ key: 'opened', dir: 'desc' }}
      empty={{
        art: 'noOrders',
        title: tr('admin.money.emptyDisputes'),
        body: tr('admin.money.emptyDisputesBody'),
      }}
      header={
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>
          <Chip label={tr('admin.money.openOnly')} selected={openOnly} onPress={() => setOpenOnly(true)} />
          <Chip
            label={tr('admin.money.allDisputes')}
            selected={!openOnly}
            onPress={() => setOpenOnly(false)}
          />
        </View>
      }
    />
  );
}
