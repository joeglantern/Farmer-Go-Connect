import type { OrderListItemDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBadges } from '../../data/badges';
import { statusView, useOrderAction, useOrders } from '../../data/orders';
import { useSession } from '../../data/session';
import { humanError } from '../../lib/errors';
import { dateShort, kes, produceName, qty, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { LeafPattern } from '../../ui/brand/Art';
import { Avatar, Card, Pill } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { SectionTitle } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { ListingRow, StatTile } from './components';
import { isLiveListing, useFarmerDashboard, useMyListings } from './data';

/** Mockup screen 9: Farmer Dashboard. */
export function FarmerHome() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const dash = useFarmerDashboard();
  const listings = useMyListings();
  const orders = useOrders('active');
  const badges = useBadges();
  const wide = size !== 'compact';
  const gutter = wide ? 32 : 20;

  const live = useMemo(
    () => (listings.data?.pages.flatMap((p) => p.items) ?? []).filter(isLiveListing),
    [listings.data],
  );
  const needsAction = useMemo(
    () =>
      (orders.data?.pages.flatMap((p) => p.items) ?? [])
        .filter((o) => o.status === 'PENDING' || o.status === 'CONFIRMED')
        .sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()),
    [orders.data],
  );
  const county = me?.user.county ?? me?.farmerProfile?.farms[0]?.county ?? null;
  const d = dash.data;
  const hasFarm = (me?.farmerProfile?.farms.length ?? 0) > 0;

  const refresh = () => {
    void dash.refetch();
    void listings.refetch();
    void orders.refetch();
  };

  const band = (
    <View
      style={[
        styles.band,
        { backgroundColor: t.colors.band, paddingTop: insets.top + 8, paddingHorizontal: gutter },
      ]}
    >
      <LeafPattern opacity={0.08} />
      <View style={styles.bandBar}>
        <Text variant="title3" tone="onBrand" accessibilityRole="header" style={{ flex: 1 }}>
          {tr('farmer.dashboard')}
        </Text>
        <IconButton
          icon="bell"
          label={tr('home.notifications')}
          badge={badges.profile}
          variant="onBrand"
          onPress={() => router.push('/notifications')}
        />
      </View>
    </View>
  );

  const profileCard = (
    <Card
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
      onPress={() => router.navigate('/profile')}
      accessibilityLabel={tr('tabs.profile')}
    >
      <Avatar uri={me?.user.imageUrl} name={me?.user.name} size={56} ring />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline" numberOfLines={1}>
          {me?.user.name}
        </Text>
        <Text variant="callout" tone="secondary" numberOfLines={1}>
          {county ? tr('farmer.countyLabel', { county }) : tr('roles.farmer')}
        </Text>
      </View>
      {me?.farmerProfile?.kycStatus === 'VERIFIED' ? (
        <Pill label={tr('farmer.verified')} tone="success" icon="checkCircle" size="sm" />
      ) : (
        <Icon name="chevronRight" size={20} color={t.colors.textTertiary} />
      )}
    </Card>
  );

  const stats = (
    <View style={{ gap: 12 }}>
      <View style={styles.statRow}>
        <StatTile
          label={tr('farmer.totalListings')}
          value={d ? String(d.activeListings) : null}
          onPress={() => router.push('/listings')}
        />
        <StatTile
          label={tr('farmer.ordersReceived')}
          value={d ? String(d.ordersReceived) : null}
          onPress={() => router.navigate('/orders')}
        />
      </View>
      <View style={styles.statRow}>
        <StatTile
          label={tr('farmer.totalSales')}
          value={d ? kes(d.totalSales) : null}
          onPress={() => router.push('/earnings')}
        />
        <StatTile
          label={tr('farmer.rating')}
          value={d ? (d.rating != null ? d.rating.toFixed(1) : tr('farmer.noRating')) : null}
          trailing={
            d?.rating != null ? <Icon name="star" size={20} color={t.colors.star} weight="fill" /> : undefined
          }
        />
      </View>
    </View>
  );

  const money = d && (d.pendingPayout > 0 || d.monthSales > 0) && (
    <Pressable
      onPress={() => router.push('/earnings')}
      accessibilityRole="button"
      accessibilityLabel={`${tr('farmer.thisMonth')}: ${kes(d.monthSales)}. ${tr('farmer.onTheWay')}: ${kes(d.pendingPayout)}`}
      focusRadius={t.radius.md}
      style={({ pressed }) => [
        styles.money,
        {
          backgroundColor: pressed ? t.colors.primaryTintStrong : t.colors.primaryTint,
          borderRadius: t.radius.md,
        },
      ]}
    >
      <Icon name="wallet" size={24} color={t.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="secondary">
          {tr('farmer.thisMonth')}
        </Text>
        <Text variant="headline" numeric>
          {kes(d.monthSales)}
        </Text>
      </View>
      {d.pendingPayout > 0 ? (
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="secondary">
            {tr('farmer.onTheWay')}
          </Text>
          <Text variant="headline" numeric>
            {kes(d.pendingPayout)}
          </Text>
        </View>
      ) : null}
      <Icon name="chevronRight" size={18} color={t.colors.primary} />
    </Pressable>
  );

  const products = (
    <View>
      <SectionTitle
        title={tr('farmer.myProducts')}
        action={live.length ? tr('common.viewAll') : undefined}
        onAction={() => router.push('/listings')}
      />
      {listings.isLoading ? (
        <View style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={82} radius={14} />
          ))}
        </View>
      ) : listings.error ? (
        <ErrorState compact onRetry={() => listings.refetch()} />
      ) : live.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
          <Icon name="basket" size={32} color={t.colors.leaf} weight="duotone" />
          <Text variant="headline" align="center">
            {tr('farmer.noListingsTitle')}
          </Text>
          <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 340 }}>
            {hasFarm ? tr('farmer.noListingsBody') : tr('farmer.noFarmBody')}
          </Text>
          <Button
            label={tr('farmer.listProduce')}
            icon="plus"
            fullWidth={false}
            size="md"
            onPress={() => router.navigate('/sell')}
          />
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {live.slice(0, wide ? 6 : 4).map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              onPress={() => router.push({ pathname: '/listings/[id]', params: { id: l.id } })}
            />
          ))}
        </View>
      )}
    </View>
  );

  const actionList = (
    <View>
      <SectionTitle
        title={tr('farmer.needsAction')}
        action={needsAction.length > 3 ? tr('common.viewAll') : undefined}
        onAction={() => router.navigate('/orders')}
      />
      {orders.isLoading ? (
        <Skeleton height={96} radius={14} />
      ) : orders.error ? (
        <ErrorState compact message={humanError(orders.error)} onRetry={() => orders.refetch()} />
      ) : needsAction.length === 0 ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="checkCircle" size={24} color={t.colors.leaf} />
          <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
            {tr('farmer.allCaughtUp')}
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {needsAction.slice(0, 3).map((o) => (
            <ActionOrder key={o.id} order={o} />
          ))}
        </View>
      )}
      {!!d?.proposedMatches && (
        <Pressable
          onPress={() => router.push('/matches')}
          accessibilityRole="button"
          accessibilityLabel={tr('farmer.matchesWaiting', { count: d.proposedMatches })}
          focusRadius={t.radius.md}
          style={({ pressed }) => [
            styles.matchBanner,
            {
              borderRadius: t.radius.md,
              borderColor: t.colors.line,
              backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
            },
          ]}
        >
          <View style={[styles.round, { backgroundColor: t.colors.infoTint }]}>
            <Icon name="handshake" size={22} color={t.colors.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{tr('farmer.matchesWaiting', { count: d.proposedMatches })}</Text>
            <Text variant="caption" tone="secondary">
              {tr('farmer.matchesHint')}
            </Text>
          </View>
          <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );

  const shortcuts: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: 'megaphone', label: tr('nav.buyersNeed'), onPress: () => router.push('/demand-board') },
    { icon: 'chart', label: tr('nav.prices'), onPress: () => router.push('/prices') },
    { icon: 'farm', label: tr('nav.farms'), onPress: () => router.push('/farms') },
    { icon: 'sprout', label: tr('nav.inputs'), onPress: () => router.push('/inputs') },
  ];
  const quick = (
    <View>
      <SectionTitle title={tr('farmer.shortcuts')} />
      <View style={styles.quickGrid}>
        {shortcuts.map((s) => (
          <Pressable
            key={s.label}
            onPress={s.onPress}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            focusRadius={t.radius.md}
            style={({ pressed, hovered }) => [
              styles.quick,
              {
                borderRadius: t.radius.md,
                borderColor: t.colors.line,
                backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
              },
            ]}
          >
            <View style={[styles.round, { backgroundColor: t.colors.primaryTint }]}>
              <Icon name={s.icon} size={22} color={t.colors.primary} />
            </View>
            <Text variant="calloutStrong" numberOfLines={2} style={{ flex: 1 }}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={dash.isRefetching} onRefresh={refresh} tintColor={t.colors.primary} />
        }
      >
        {band}
        <View
          style={{
            paddingHorizontal: gutter,
            marginTop: -44,
            width: '100%',
            maxWidth: t.layout.contentMax,
            alignSelf: 'center',
            gap: 14,
          }}
        >
          {profileCard}
          {dash.error && (
            <ErrorState compact message={humanError(dash.error)} onRetry={() => dash.refetch()} />
          )}
          {wide ? (
            <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
              <View style={{ flex: 1.4, gap: 14 }}>
                {stats}
                {money}
                {products}
              </View>
              <View style={{ flex: 1 }}>
                {actionList}
                {quick}
              </View>
            </View>
          ) : (
            <>
              {stats}
              {money}
              {actionList}
              {products}
              {quick}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** An order waiting on the farmer, with its next step inline. */
function ActionOrder({ order }: { order: OrderListItemDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const action = useOrderAction(order.id);
  const s = statusView(order.status, 'farmer');
  const first = order.items[0];
  const total = order.items.reduce((sum, i) => sum + i.lineTotal, 0);
  const what = first
    ? `${qty(Number(first.quantity))} ${unitLabel(first.listing.produce.unit, Number(first.quantity))} ${produceName(first.listing.produce)}${
        order.items.length > 1 ? ` ${tr('orders.andMore', { count: order.items.length - 1 })}` : ''
      }`
    : order.code;
  const pending = order.status === 'PENDING';

  const run = async () => {
    const ok = await dialog.confirm(
      pending
        ? {
            title: tr('farmer.confirmTitle'),
            message: tr('farmer.confirmBody', {
              what,
              buyer: order.buyerOrg.name,
              date: dateShort(order.deliveryDate),
            }),
            confirmLabel: tr('orders.confirm'),
            icon: 'check',
          }
        : {
            title: tr('orders.readyTitle'),
            message: tr('orders.readyBody'),
            confirmLabel: tr('orders.markReady'),
            icon: 'basket',
          },
    );
    if (!ok) return;
    try {
      await action.mutateAsync({ path: pending ? 'confirm' : 'ready' });
      toast.success(pending ? tr('orders.confirmed') : tr('orders.readyDone'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    // The card body opens the order; the action button sits beside it, not inside it
    // (a button may not contain a button).
    <Card style={{ gap: 12 }}>
      <Pressable
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
        accessibilityLabel={`${order.code}, ${what}, ${tr(s.labelKey)}`}
        focusRadius={t.radius.sm}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {what}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {order.buyerOrg.name} · {tr('orders.deliveryOn', { date: dateShort(order.deliveryDate) })}
          </Text>
        </View>
        <Text variant="bodyStrong" numeric>
          {kes(total)}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pill label={tr(s.labelKey)} tone={s.tone} icon={s.icon} size="sm" />
        <View style={{ flex: 1 }} />
        <Button
          label={pending ? tr('orders.confirm') : tr('orders.markReady')}
          icon={pending ? 'check' : 'basket'}
          size="sm"
          fullWidth={false}
          loading={action.isPending}
          onPress={run}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  band: { paddingBottom: 60, overflow: 'hidden' },
  bandBar: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  statRow: { flexDirection: 'row', gap: 12 },
  money: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  matchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quick: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
  },
});
