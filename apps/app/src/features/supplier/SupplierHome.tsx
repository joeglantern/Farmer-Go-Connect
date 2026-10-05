import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { kes, qty, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen, SectionTitle } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { Stat } from '../qa/QaTasks';
import {
  CATEGORY_ICON,
  useLowStockIds,
  useMyProducts,
  useSupplierDashboard,
  useSupplierOrders,
  useSupplierOrg,
} from './data';
import { InputOrderCard } from './InputOrderCard';

/** Youth enterprise home: orders to act on, this month's sales, stock running low. */
export function SupplierHome() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const org = useSupplierOrg();
  const orders = useSupplierOrders();
  const products = useMyProducts();

  const dash = useSupplierDashboard();
  const d = dash.data;
  const act = useMemo(
    () => (orders.data ?? []).filter((o) => o.status === 'PENDING' || o.status === 'ACCEPTED').slice(0, 4),
    [orders.data],
  );
  const lowIds = useLowStockIds(products.data);
  const low = (products.data ?? []).filter((p) => lowIds.has(p.id));
  const active = (products.data ?? []).filter((p) => p.active);
  const wide = size !== 'compact';
  const loading = orders.isLoading || products.isLoading || dash.isLoading;
  const refresh = () => {
    void orders.refetch();
    void products.refetch();
    void dash.refetch();
  };

  if (!org) {
    return (
      <Screen header={<Header title={tr('supplier.homeTitle')} back={false} large />}>
        <EmptyState
          art="noListings"
          title={tr('supplier.noOrgTitle')}
          body={tr('supplier.noOrgBody')}
          action={{
            label: tr('supplier.finishSetup'),
            onPress: () => router.push('/setup'),
            icon: 'storefront',
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={
        <Header
          title={org.name}
          subtitle={tr('supplier.homeSubtitle')}
          back={false}
          large
          right={
            wide ? (
              <Button
                label={tr('supplier.addProduct')}
                icon="plus"
                size="md"
                fullWidth={false}
                onPress={() => router.push({ pathname: '/products/[id]', params: { id: 'new' } })}
              />
            ) : undefined
          }
        />
      }
      refreshing={orders.isRefetching || products.isRefetching || dash.isRefetching}
      onRefresh={refresh}
    >
      {loading ? (
        <SkeletonList count={4} height={120} />
      ) : orders.error || products.error || dash.error || !d ? (
        <ErrorState onRetry={refresh} />
      ) : (
        <View style={{ gap: 24 }}>
          <View style={[styles.hero, { backgroundColor: t.colors.band, borderRadius: t.radius.lg }]}>
            <Text variant="caption" tone="onBrandMuted">
              {tr('supplier.salesThisMonth')}
            </Text>
            <Text variant="display" tone="onBrand" numeric>
              {kes(d.salesThisMonthCents)}
            </Text>
            <Text variant="callout" tone="onBrandMuted" numeric>
              {tr('supplier.heroLine', { count: d.ordersThisMonth, paid: kes(d.paidOutAllTimeCents) })}
            </Text>
            <Pressable
              onPress={() => router.push('/input-orders')}
              accessibilityRole="link"
              accessibilityLabel={tr('supplier.allOrders')}
              style={styles.heroLink}
            >
              <Text variant="calloutStrong" style={{ color: t.colors.accentLime }}>
                {tr('supplier.allOrders')}
              </Text>
              <Icon name="forward" size={16} color={t.colors.accentLime} />
            </Pressable>
          </View>

          <View style={styles.stats}>
            <Stat
              label={tr('supplier.toHandle')}
              value={String(d.ordersToHandle)}
              icon="bell"
              warn={d.ordersToHandle > 0}
            />
            <Stat label={tr('supplier.products')} value={String(d.activeProducts)} icon="storefront" />
            <Stat
              label={tr('supplier.lowStock')}
              value={String(d.lowStockProducts)}
              icon="warning"
              warn={d.lowStockProducts > 0}
            />
          </View>

          <View style={[{ gap: 24 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
            <View style={{ flex: 1.3, gap: 12 }}>
              <SectionTitle
                title={tr('supplier.needsYou')}
                action={act.length ? tr('common.seeAll') : undefined}
                onAction={() => router.push('/input-orders')}
              />
              {act.length === 0 ? (
                <Card>
                  <EmptyState
                    compact
                    art="noOrders"
                    title={tr('supplier.allCaughtUp')}
                    body={tr('supplier.allCaughtUpBody')}
                  />
                </Card>
              ) : (
                act.map((o) => <InputOrderCard key={o.id} order={o} />)
              )}
            </View>

            <View style={{ flex: 1, gap: 12 }}>
              <SectionTitle
                title={low.length ? tr('supplier.lowStock') : tr('supplier.yourProducts')}
                action={tr('common.seeAll')}
                onAction={() => router.push('/products')}
              />
              {active.length === 0 ? (
                <Card>
                  <EmptyState
                    compact
                    art="noListings"
                    title={tr('supplier.noProductsTitle')}
                    body={tr('supplier.noProductsBody')}
                    action={{
                      label: tr('supplier.addProduct'),
                      onPress: () => router.push({ pathname: '/products/[id]', params: { id: 'new' } }),
                      icon: 'plus',
                    }}
                  />
                </Card>
              ) : (
                <Card padded={false}>
                  {(low.length ? low : active).slice(0, 5).map((p, i) => (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push({ pathname: '/products/[id]', params: { id: p.id } })}
                      accessibilityLabel={p.name}
                      style={({ pressed }) => [
                        styles.productRow,
                        {
                          borderTopWidth: i ? 1 : 0,
                          borderTopColor: t.colors.line,
                          backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent',
                        },
                      ]}
                    >
                      {p.photoUrls[0] ? (
                        <ProduceImage uri={p.photoUrls[0]} size={44} radius={10} />
                      ) : (
                        <View style={[styles.catIcon, { backgroundColor: t.colors.primaryTint }]}>
                          <Icon name={CATEGORY_ICON[p.category]} size={20} color={t.colors.primary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text variant="caption" tone="tertiary" numeric>
                          {kes(p.pricePerUnit)}/{unitLabel(p.unit)}
                        </Text>
                      </View>
                      <Pill
                        label={`${qty(p.stock)} ${unitLabel(p.unit, p.stock)}`}
                        tone={lowIds.has(p.id) ? (p.stock === 0 ? 'danger' : 'warning') : 'neutral'}
                        size="sm"
                      />
                    </Pressable>
                  ))}
                </Card>
              )}
            </View>
          </View>

          {!wide && (
            <Button
              label={tr('supplier.addProduct')}
              icon="plus"
              variant="secondary"
              onPress={() => router.push({ pathname: '/products/[id]', params: { id: 'new' } })}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, gap: 4 },
  heroLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
    minHeight: 32,
  },
  stats: { flexDirection: 'row', gap: 12 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 64,
  },
  catIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
