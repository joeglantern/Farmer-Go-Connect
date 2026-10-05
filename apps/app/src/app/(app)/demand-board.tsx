import type { DemandBoardRowDto } from '@farmgo/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useProduce } from '../../data/catalog';
import { useSession } from '../../data/session';
import { useDemandBoard } from '../../features/farmer/data';
import { dateShort, kes, qty, unitLabel } from '../../lib/format';
import { useRole } from '../../nav/Shell';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Chip, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Sheet } from '../../ui/overlays/Sheet';
import { CountyPicker } from '../../ui/Pickers';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

interface Group {
  key: string;
  produceId: string;
  name: string;
  unit: string;
  county: string;
  openQty: number;
  buyers: number;
  avgMaxPrice: number | null;
  weeks: DemandBoardRowDto[];
  /** With the "mine" filter: my listings that could fill this. */
  listingIds: string[];
}

/**
 * What buyers need, by produce and county over the next weeks (anonymised). Farmers list
 * produce against a row; agents see the same board for the farmers they support.
 */
export default function DemandBoard() {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const size = useSizeClass();
  const role = useRole();
  const me = useSession((s) => s.me);
  // A notification can open the board on one produce in one county (B14 demandBoard link).
  const linked = useLocalSearchParams<{ produceId?: string; county?: string }>();
  const defaultCounty = linked.county || me?.farmerProfile?.farms[0]?.county || me?.user.county || null;
  const [county, setCounty] = useState<string | null>(defaultCounty);
  const [weeks, setWeeks] = useState(4);
  const [countyOpen, setCountyOpen] = useState(false);
  const [open, setOpen] = useState<Group | null>(null);
  const [mine, setMine] = useState(false);
  const board = useDemandBoard(county, weeks, mine);
  const produce = useProduce();

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of board.data ?? []) {
      const key = `${r.produceId}:${r.county}`;
      const g = map.get(key) ?? {
        key,
        produceId: r.produceId,
        name: i18n.language === 'sw' ? r.produceNameSw : r.produceName,
        unit: r.unit,
        county: r.county,
        openQty: 0,
        buyers: 0,
        avgMaxPrice: null,
        weeks: [],
        listingIds: [],
      };
      g.openQty += r.openQty;
      g.buyers = Math.max(g.buyers, r.buyers);
      if (r.avgMaxPrice != null) g.avgMaxPrice = Math.max(g.avgMaxPrice ?? 0, r.avgMaxPrice);
      g.weeks.push(r);
      for (const id of r.listingIds ?? []) if (!g.listingIds.includes(id)) g.listingIds.push(id);
      map.set(key, g);
    }
    return [...map.values()].filter((g) => g.openQty > 0).sort((a, b) => b.openQty - a.openQty);
  }, [board.data, i18n.language]);

  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || !linked.produceId) return;
    const g = groups.find(
      (x) => x.produceId === linked.produceId && (!linked.county || x.county === linked.county),
    );
    if (g) {
      openedFromLink.current = true;
      setOpen(g);
    }
  }, [groups, linked.produceId, linked.county]);

  const columns = size === 'expanded' ? 2 : 1;
  const canSell = role === 'farmer' || role === 'agent';

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('nav.buyersNeed')}
        subtitle={size === 'compact' ? undefined : tr('demand.subtitle')}
        large={size === 'compact'}
      />
      <View style={[styles.filters, { paddingHorizontal: size === 'compact' ? 20 : 32 }]}>
        <Chip
          label={county ?? tr('demand.allCounties')}
          icon="location"
          selected={!!county}
          onPress={() => setCountyOpen(true)}
        />
        {county && <Chip label={tr('demand.allCounties')} onPress={() => setCounty(null)} />}
        {role === 'farmer' && (
          <Chip label={tr('demand.mine')} icon="basket" selected={mine} onPress={() => setMine((v) => !v)} />
        )}
        <View style={{ flex: 1 }} />
        {[2, 4, 8].map((w) => (
          <Chip
            key={w}
            label={tr('demand.weeks', { count: w })}
            selected={weeks === w}
            onPress={() => setWeeks(w)}
          />
        ))}
      </View>
      {board.isLoading ? (
        <View style={{ padding: 20 }}>
          <SkeletonList count={5} height={96} />
        </View>
      ) : board.error ? (
        <ErrorState onRetry={() => board.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={groups}
          numColumns={columns}
          keyExtractor={(g) => g.key}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{
            padding: size === 'compact' ? 20 : 32,
            paddingTop: 8,
            gap: 12,
            maxWidth: t.layout.contentMax,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={board.isRefetching}
          onRefresh={() => board.refetch()}
          ListHeaderComponent={
            groups.length > 0 ? (
              <Text variant="caption" tone="secondary" style={{ marginBottom: 4 }}>
                {tr('demand.anonNote')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const p = produce.data?.find((x) => x.id === item.produceId);
            return (
              <View style={{ flex: 1 }}>
                <Card
                  onPress={() => setOpen(item)}
                  accessibilityLabel={`${item.name}, ${item.county}, ${tr('demand.needed', { qty: qty(item.openQty), unit: unitLabel(item.unit, item.openQty) })}`}
                  style={{ gap: 12 }}
                >
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <ProduceImage uri={p?.imageUrl} produce={p} category={p?.category} size={52} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{item.name}</Text>
                      <Text variant="caption" tone="secondary">
                        {item.county} · {tr('demand.buyers', { count: item.buyers })}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="headline" numeric>
                        {qty(item.openQty)}
                      </Text>
                      <Text variant="caption" tone="tertiary">
                        {unitLabel(item.unit, item.openQty)}
                      </Text>
                    </View>
                  </View>
                  <WeekBars weeks={item.weeks} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {item.avgMaxPrice != null ? (
                      <Pill
                        label={tr('demand.upTo', {
                          price: kes(item.avgMaxPrice),
                          unit: unitLabel(item.unit),
                        })}
                        tone="brand"
                        icon="money"
                        size="sm"
                      />
                    ) : (
                      <Pill label={tr('demand.openPrice')} size="sm" />
                    )}
                    {item.listingIds.length > 0 && (
                      <Pill label={tr('demand.matchesYours')} tone="success" icon="check" size="sm" />
                    )}
                    <View style={{ flex: 1 }} />
                    <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
                  </View>
                </Card>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={mine ? tr('demand.mineEmptyTitle') : tr('demand.emptyTitle')}
              body={
                mine
                  ? tr('demand.mineEmptyBody')
                  : county
                    ? tr('demand.emptyCounty', { county })
                    : tr('demand.emptyBody')
              }
              action={
                county ? { label: tr('demand.allCounties'), onPress: () => setCounty(null) } : undefined
              }
            />
          }
        />
      )}
      <CountyPicker
        visible={countyOpen}
        onClose={() => setCountyOpen(false)}
        value={county}
        onSelect={setCounty}
      />
      <Sheet
        visible={!!open}
        onClose={() => setOpen(null)}
        title={open ? open.name : ''}
        subtitle={open ? tr('demand.sheetSub', { county: open.county, count: open.buyers }) : undefined}
        footer={
          open && canSell ? (
            <Button
              label={role === 'agent' ? tr('demand.agentAction') : tr('demand.listThis')}
              icon={role === 'agent' ? 'users' : 'plus'}
              onPress={() => {
                const g = open;
                setOpen(null);
                if (role === 'agent') router.navigate('/home');
                else
                  router.navigate({
                    pathname: '/sell',
                    params: {
                      produceId: g.produceId,
                      quantity: String(Math.ceil(g.openQty)),
                      ...(g.avgMaxPrice ? { price: String(g.avgMaxPrice) } : {}),
                    },
                  });
              }}
            />
          ) : undefined
        }
      >
        {open && (
          <View style={{ gap: 10 }}>
            {open.weeks
              .slice()
              .sort((a, b) => a.week.localeCompare(b.week))
              .map((w) => (
                <View
                  key={w.week}
                  style={[styles.weekRow, { borderColor: t.colors.line, borderRadius: t.radius.sm }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="calloutStrong">{tr('demand.weekOf', { date: dateShort(w.week) })}</Text>
                    <Text variant="caption" tone="secondary">
                      {tr('demand.buyers', { count: w.buyers })}
                      {w.avgMaxPrice != null
                        ? ` · ${tr('demand.upTo', { price: kes(w.avgMaxPrice), unit: unitLabel(w.unit) })}`
                        : ''}
                    </Text>
                  </View>
                  <Text variant="bodyStrong" numeric>
                    {qty(w.openQty)} {unitLabel(w.unit, w.openQty)}
                  </Text>
                </View>
              ))}
            {open.listingIds.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text variant="calloutStrong">
                  {tr('demand.yourListings', { count: open.listingIds.length })}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {open.listingIds.map((id, i) => (
                    <Chip
                      key={id}
                      label={tr('demand.listingN', { n: i + 1 })}
                      icon="basket"
                      onPress={() => {
                        setOpen(null);
                        router.push({ pathname: '/listings/[id]', params: { id } });
                      }}
                    />
                  ))}
                </View>
              </View>
            )}
            <Text variant="caption" tone="tertiary">
              {open.listingIds.length > 0
                ? tr('demand.mineNote')
                : canSell
                  ? tr('demand.howMatching')
                  : tr('demand.anonNote')}
            </Text>
          </View>
        )}
      </Sheet>
    </View>
  );
}

/** Open quantity per week as small bars. */
function WeekBars({ weeks }: { weeks: DemandBoardRowDto[] }) {
  const t = useTheme();
  const sorted = weeks.slice().sort((a, b) => a.week.localeCompare(b.week));
  const max = Math.max(...sorted.map((w) => w.openQty), 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 44 }} accessible={false}>
      {sorted.map((w) => (
        <View key={w.week} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <View
            style={{
              width: '100%',
              height: Math.max(4, (w.openQty / max) * 28),
              borderRadius: 4,
              backgroundColor: t.colors.primaryTintStrong,
            }}
          />
          <Text variant="micro" tone="tertiary">
            {dateShort(w.week)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBottom: 8 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
});
