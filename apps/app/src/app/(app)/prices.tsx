import type { LatestPriceDto } from '@farmgo/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useProduce } from '../../data/catalog';
import { useSession } from '../../data/session';
import { useLatestPrices, usePriceHistory } from '../../features/farmer/data';
import { dateShort, kes, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Card, Chip, Pill } from '../../ui/Controls';
import { ProduceImage } from '../../ui/Media';
import { Sheet } from '../../ui/overlays/Sheet';
import { CountyPicker } from '../../ui/Pickers';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { Skeleton, SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';

/** Market prices: this week's transacted prices per produce, with a 12-week trend. For every role. */
export default function Prices() {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const [county, setCounty] = useState<string | null>(
    me?.organizations[0]?.profile?.county ?? me?.farmerProfile?.farms[0]?.county ?? me?.user.county ?? null,
  );
  const [countyOpen, setCountyOpen] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<LatestPriceDto | null>(null);
  const prices = useLatestPrices(county);
  const produce = useProduce();
  const sw = i18n.language === 'sw';

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (prices.data ?? [])
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.nameSw.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [prices.data, q]);
  const week = prices.data?.[0]?.week;
  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const gutter = size === 'compact' ? 20 : 32;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('nav.prices')}
        subtitle={week ? tr('prices.weekOf', { date: dateShort(week) }) : undefined}
        large={size === 'compact'}
      />
      <View
        style={{
          paddingHorizontal: gutter,
          gap: 10,
          paddingBottom: 12,
          maxWidth: t.layout.contentMax,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <SearchField value={q} onChangeText={setQ} placeholder={tr('prices.search')} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip
            label={county ?? tr('prices.allKenya')}
            icon="location"
            selected={!!county}
            onPress={() => setCountyOpen(true)}
          />
          {county && <Chip label={tr('prices.allKenya')} onPress={() => setCounty(null)} />}
        </View>
      </View>
      {prices.isLoading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonList count={6} height={72} />
        </View>
      ) : prices.error ? (
        <ErrorState onRetry={() => prices.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(p) => `${p.produceId}:${p.county}`}
          columnWrapperStyle={columns > 1 ? { gap: 10 } : undefined}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: 32,
            gap: 10,
            maxWidth: t.layout.contentMax,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={prices.isRefetching}
          onRefresh={() => prices.refetch()}
          renderItem={({ item }) => {
            const p = produce.data?.find((x) => x.id === item.produceId);
            const up = (item.changePct ?? 0) >= 0;
            return (
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={() => setOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${sw ? item.nameSw : item.name}, ${kes(item.avgPrice)} ${tr('common.perUnit', { unit: unitLabel(item.unit) })}`}
                  focusRadius={t.radius.md}
                  style={({ pressed, hovered }) => [
                    styles.row,
                    {
                      borderRadius: t.radius.md,
                      borderColor: t.colors.line,
                      backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
                    },
                  ]}
                >
                  <ProduceImage uri={p?.imageUrl} produce={p} category={p?.category} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {sw ? item.nameSw : item.name}
                    </Text>
                    <Text variant="caption" tone="tertiary" numeric>
                      {tr('prices.range', { min: kes(item.minPrice), max: kes(item.maxPrice) })}
                      {county ? '' : ` · ${item.county}`}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text variant="headline" numeric>
                      {kes(item.avgPrice)}
                      <Text variant="caption" tone="tertiary">
                        {' '}
                        /{unitLabel(item.unit)}
                      </Text>
                    </Text>
                    {item.changePct != null && (
                      <Pill
                        label={`${up ? '+' : ''}${item.changePct}%`}
                        tone={up ? 'success' : 'warning'}
                        icon={up ? 'trendUp' : 'trendDown'}
                        size="sm"
                      />
                    )}
                  </View>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={q ? tr('prices.noMatch') : tr('prices.emptyTitle')}
              body={q ? undefined : tr('prices.emptyBody')}
              action={
                county && !q ? { label: tr('prices.allKenya'), onPress: () => setCounty(null) } : undefined
              }
            />
          }
          ListFooterComponent={
            items.length > 0 ? (
              <Text variant="caption" tone="tertiary" style={{ marginTop: 8 }}>
                {tr('prices.source')}
              </Text>
            ) : null
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
        title={open ? (sw ? open.nameSw : open.name) : ''}
        subtitle={open ? tr('prices.trendSub', { county: county ?? tr('prices.allKenya') }) : undefined}
      >
        {open && <Trend produceId={open.produceId} county={county} unit={open.unit} />}
      </Sheet>
    </View>
  );
}

/** 12-week average price as a simple bar chart, with the latest value labelled. */
function Trend({ produceId, county, unit }: { produceId: string; county: string | null; unit: string }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const h = usePriceHistory(produceId, county, 12);
  const weeks = useMemo(() => {
    const byWeek = new Map<string, { sum: number; n: number }>();
    for (const p of h.data ?? []) {
      const k = p.week.slice(0, 10);
      const v = byWeek.get(k) ?? { sum: 0, n: 0 };
      v.sum += p.avgPrice;
      v.n += 1;
      byWeek.set(k, v);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({ week, avg: Math.round(v.sum / v.n) }));
  }, [h.data]);
  if (h.isLoading) return <Skeleton height={180} radius={12} />;
  if (h.error) return <ErrorState compact onRetry={() => h.refetch()} />;
  if (weeks.length === 0)
    return (
      <Text variant="callout" tone="secondary">
        {tr('prices.noHistory')}
      </Text>
    );
  const max = Math.max(...weeks.map((w) => w.avg));
  const min = Math.min(...weeks.map((w) => w.avg));
  const last = weeks[weeks.length - 1]!;
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text variant="caption" tone="secondary">
            {tr('prices.latest')}
          </Text>
          <Text variant="title2" numeric>
            {kes(last.avg)}
            <Text variant="callout" tone="tertiary">
              {' '}
              /{unitLabel(unit)}
            </Text>
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" tone="secondary">
            {tr('prices.twelveWeeks')}
          </Text>
          <Text variant="callout" numeric>
            {tr('prices.range', { min: kes(min), max: kes(max) })}
          </Text>
        </View>
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120 }}
        accessibilityRole="image"
        accessibilityLabel={tr('prices.chartLabel', { weeks: weeks.length, min: kes(min), max: kes(max) })}
      >
        {weeks.map((w, i) => (
          <View
            key={w.week}
            style={{
              flex: 1,
              height: `${Math.max(6, (w.avg / max) * 100)}%`,
              borderRadius: 4,
              backgroundColor: i === weeks.length - 1 ? t.colors.primary : t.colors.primaryTintStrong,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="micro" tone="tertiary">
          {dateShort(weeks[0]!.week)}
        </Text>
        <Text variant="micro" tone="tertiary">
          {dateShort(last.week)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
});
