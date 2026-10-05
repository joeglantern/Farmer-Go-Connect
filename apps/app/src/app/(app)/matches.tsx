import type { MatchAcceptDto, MatchListItemDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useMatchAction, useMatches } from '../../features/farmer/data';
import { humanError } from '../../lib/errors';
import { dateShort, kes, produceName, qty, timeAgo, unitLabel } from '../../lib/format';
import { useRole } from '../../nav/Shell';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill, Segmented } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

type Scope = 'waiting' | 'accepted' | 'past';

/**
 * Matches between a buyer requirement and a farmer listing. Both sides accept; the order is
 * created once they have. Farmers and buyers see the same match from their own side.
 */
export default function Matches() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const role = useRole();
  const side: 'farmer' | 'buyer' = role === 'farmer' || role === 'agent' ? 'farmer' : 'buyer';
  const [scope, setScope] = useState<Scope>('waiting');
  const q = useMatches(scope === 'past' ? undefined : scope === 'waiting' ? 'PROPOSED' : 'ACCEPTED');

  const items = useMemo(() => {
    const all = q.data?.pages.flatMap((p) => p.items) ?? [];
    if (scope === 'past') return all.filter((m) => m.status === 'REJECTED' || m.status === 'EXPIRED');
    return all;
  }, [q.data, scope]);
  const waitingOnMe = items.filter(
    (m) => m.status === 'PROPOSED' && !(side === 'farmer' ? m.farmerAcceptedAt : m.buyerAcceptedAt),
  ).length;
  const columns = size === 'expanded' ? 2 : 1;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('nav.matches')}
        subtitle={size === 'compact' ? undefined : tr(`matches.intro.${side}`)}
        large={size === 'compact'}
      />
      <View
        style={{
          paddingHorizontal: size === 'compact' ? 20 : 32,
          paddingBottom: 12,
          maxWidth: t.layout.contentMax,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            {
              value: 'waiting',
              label: tr('matches.waiting'),
              count: scope === 'waiting' && waitingOnMe ? waitingOnMe : undefined,
            },
            { value: 'accepted', label: tr('matches.accepted') },
            { value: 'past', label: tr('matches.past') },
          ]}
        />
      </View>
      {q.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <SkeletonList count={4} height={150} />
        </View>
      ) : q.error ? (
        <ErrorState onRetry={() => q.refetch()} message={humanError(q.error)} />
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(m) => m.id}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{
            paddingHorizontal: size === 'compact' ? 20 : 32,
            paddingBottom: 32,
            gap: 12,
            maxWidth: t.layout.contentMax,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={q.isRefetching}
          onRefresh={() => q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <MatchCard m={item} side={side} />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={tr(`matches.empty.${scope}`)}
              body={scope === 'waiting' ? tr(`matches.emptyBody.${side}`) : undefined}
              action={
                scope === 'waiting'
                  ? side === 'farmer'
                    ? {
                        label: tr('nav.buyersNeed'),
                        icon: 'megaphone',
                        onPress: () => router.push('/demand-board'),
                      }
                    : {
                        label: tr('matches.postRequirement'),
                        icon: 'plus',
                        onPress: () => router.push('/requirements/new'),
                      }
                  : undefined
              }
            />
          }
        />
      )}
    </View>
  );
}

function MatchCard({ m, side }: { m: MatchListItemDto; side: 'farmer' | 'buyer' }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const action = useMatchAction();
  const p = m.demand.produce;
  const quantity = Number(m.quantity);
  const unit = unitLabel(p.unit, quantity);
  const mine = side === 'farmer' ? m.farmerAcceptedAt : m.buyerAcceptedAt;
  const theirs = side === 'farmer' ? m.buyerAcceptedAt : m.farmerAcceptedAt;
  const proposed = m.status === 'PROPOSED';
  const expiresSoon = proposed && new Date(m.expiresAt).getTime() - Date.now() < 86_400_000;
  const total = Math.round(quantity * m.pricePerUnit);

  const status = (() => {
    if (m.status === 'ACCEPTED')
      return { label: tr('matches.status.accepted'), tone: 'success' as const, icon: 'handshake' as const };
    if (m.status === 'REJECTED')
      return { label: tr('matches.status.declined'), tone: 'neutral' as const, icon: 'close' as const };
    if (m.status === 'EXPIRED')
      return { label: tr('matches.status.expired'), tone: 'neutral' as const, icon: 'clock' as const };
    if (mine)
      return {
        label: tr(`matches.status.waitingOn.${side === 'farmer' ? 'buyer' : 'farmer'}`),
        tone: 'info' as const,
        icon: 'clock' as const,
      };
    return { label: tr('matches.status.yourTurn'), tone: 'warning' as const, icon: 'bell' as const };
  })();

  const accept = async () => {
    const ok = await dialog.confirm({
      title: tr('matches.acceptTitle'),
      message: tr(`matches.acceptBody.${side}`, {
        qty: qty(quantity),
        unit,
        name: produceName(p),
        price: kes(m.pricePerUnit),
        date: dateShort(m.demand.neededBy),
      }),
      confirmLabel: tr('matches.accept'),
      icon: 'handshake',
    });
    if (!ok) return;
    try {
      const res = (await action.mutateAsync({ id: m.id, action: 'accept' })) as MatchAcceptDto;
      if (res.orderId) {
        toast.show({
          message: tr('matches.orderCreated'),
          tone: 'success',
          action: {
            label: tr('matches.viewOrder'),
            onPress: () => router.push({ pathname: '/order/[id]', params: { id: res.orderId! } }),
          },
        });
      } else toast.success(tr(`matches.acceptedWaiting.${side === 'farmer' ? 'buyer' : 'farmer'}`));
    } catch (err) {
      toast.error(humanError(err));
    }
  };
  const decline = async () => {
    const ok = await dialog.confirm({
      title: tr('matches.declineTitle'),
      message: tr('matches.declineBody'),
      confirmLabel: tr('matches.decline'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await action.mutateAsync({ id: m.id, action: 'reject' });
      toast.success(tr('matches.declined'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <ProduceImage uri={p.imageUrl} produce={p} category={p.category} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">
            {qty(quantity)} {unit} {produceName(p)}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {side === 'farmer'
              ? tr('matches.forBuyerIn', { county: m.demand.county, date: dateShort(m.demand.neededBy) })
              : tr('matches.fromFarm', { farm: m.listing.farm.name, county: m.listing.farm.county })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="headline" numeric>
            {kes(total)}
          </Text>
          <Text variant="caption" tone="tertiary" numeric>
            {kes(m.pricePerUnit)} / {unitLabel(p.unit)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill label={status.label} tone={status.tone} icon={status.icon} size="sm" />
        {m.distanceKm != null && (
          <Pill label={tr('common.km', { km: Math.round(m.distanceKm) })} icon="location" size="sm" />
        )}
        {m.listing.farm.isOrganic && (
          <Pill label={tr('farms.organic')} tone="success" icon="leaf" size="sm" />
        )}
        {m.demand.minGrade && <Pill label={tr('matches.minGrade', { grade: m.demand.minGrade })} size="sm" />}
      </View>
      {proposed && (
        <View style={[styles.sides, { borderColor: t.colors.line, borderRadius: t.radius.sm }]}>
          <SideTick label={tr('matches.you')} done={!!mine} />
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
          <SideTick
            label={side === 'farmer' ? tr('matches.theBuyer') : tr('matches.theFarmer')}
            done={!!theirs}
          />
        </View>
      )}
      {proposed && !mine && (
        <>
          {expiresSoon && (
            <Text variant="caption" tone="warning">
              {tr('matches.expires', { when: timeAgoFuture(m.expiresAt, tr) })}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label={tr('matches.decline')}
              variant="outline"
              size="md"
              fullWidth={false}
              onPress={decline}
              disabled={action.isPending}
              style={{ flex: 1 }}
            />
            <Button
              label={tr('matches.accept')}
              icon="handshake"
              size="md"
              onPress={accept}
              loading={action.isPending}
              style={{ flex: 1.4 }}
            />
          </View>
        </>
      )}
      {m.orderItem && (
        <Button
          label={tr('matches.viewOrder')}
          icon="receipt"
          variant="ghost"
          size="md"
          onPress={() => router.push({ pathname: '/order/[id]', params: { id: m.orderItem!.orderId } })}
        />
      )}
      {!proposed && !m.orderItem && (
        <Text variant="caption" tone="tertiary">
          {timeAgo(m.updatedAt)}
        </Text>
      )}
    </Card>
  );
}

function SideTick({ label, done }: { label: string; done: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon
        name={done ? 'checkCircle' : 'clock'}
        size={18}
        color={done ? t.colors.primary : t.colors.textTertiary}
        weight={done ? 'fill' : 'regular'}
      />
      <Text variant="caption" tone={done ? 'default' : 'tertiary'}>
        {label}
      </Text>
    </View>
  );
}

function timeAgoFuture(iso: string, tr: (k: string, o?: Record<string, unknown>) => string) {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return h < 1 ? tr('matches.lessThanHour') : tr('matches.hours', { count: h });
}

const styles = StyleSheet.create({
  sides: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1 },
});
