import type { InputProductListItemDto } from '@farmgo/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useInputs, useMyInputOrders } from '../../features/farmer/data';
import { INPUT_CATEGORIES, InputOrderRow } from '../../features/farmer/InputOrderRow';
import { kes, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Chip, Pill, Segmented } from '../../ui/Controls';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';

/** Green inputs from youth enterprises: compost, organic fertilizer, seedlings and more. */
export default function Inputs() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'shop' | 'orders'>(params.tab === 'orders' ? 'orders' : 'shop');
  // Returning here after placing an order opens My orders.
  useEffect(() => {
    if (params.tab === 'orders') setTab('orders');
  }, [params.tab]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const products = useInputs({ q: q.trim() || undefined, category: category ?? undefined });
  const orders = useMyInputOrders();
  const items = useMemo(() => products.data?.pages.flatMap((p) => p.items) ?? [], [products.data]);
  const openOrders = (orders.data ?? []).filter((o) =>
    ['PENDING', 'ACCEPTED', 'DISPATCHED'].includes(o.status),
  ).length;
  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const gutter = size === 'compact' ? 20 : 32;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('nav.inputs')}
        subtitle={size === 'compact' ? undefined : tr('inputs.subtitle')}
        large={size === 'compact'}
      />
      <View
        style={{
          paddingHorizontal: gutter,
          gap: 12,
          paddingBottom: 12,
          maxWidth: t.layout.contentMax,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'shop', label: tr('inputs.shop') },
            { value: 'orders', label: tr('inputs.myOrders'), count: openOrders || undefined },
          ]}
        />
        {tab === 'shop' && (
          <>
            <SearchField value={q} onChangeText={setQ} placeholder={tr('inputs.search')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={tr('catalog.filter.all')} selected={!category} onPress={() => setCategory(null)} />
              {INPUT_CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={tr(`inputs.cat.${c}`)}
                  selected={category === c}
                  onPress={() => setCategory(category === c ? null : c)}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>
      {tab === 'shop' ? (
        products.isLoading ? (
          <View style={{ paddingHorizontal: gutter }}>
            <SkeletonList count={4} height={96} />
          </View>
        ) : products.error ? (
          <ErrorState onRetry={() => products.refetch()} />
        ) : (
          <FlatList
            key={columns}
            data={items}
            numColumns={columns}
            keyExtractor={(p) => p.id}
            columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingBottom: 32,
              gap: 12,
              maxWidth: t.layout.contentMax,
              width: '100%',
              alignSelf: 'center',
            }}
            refreshing={products.isRefetching}
            onRefresh={() => products.refetch()}
            onEndReached={() =>
              products.hasNextPage && !products.isFetchingNextPage && products.fetchNextPage()
            }
            renderItem={({ item }) => (
              <View style={{ flex: 1 }}>
                <InputCard p={item} />
              </View>
            )}
            ListEmptyComponent={
              <EmptyState
                art="noResults"
                title={tr('inputs.emptyTitle')}
                body={q || category ? tr('inputs.emptyFiltered') : tr('inputs.emptyBody')}
              />
            }
          />
        )
      ) : orders.isLoading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonList count={3} height={96} />
        </View>
      ) : orders.error ? (
        <ErrorState onRetry={() => orders.refetch()} />
      ) : (
        <FlatList
          data={orders.data ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: 32,
            gap: 10,
            maxWidth: 860,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={orders.isRefetching}
          onRefresh={() => orders.refetch()}
          renderItem={({ item }) => <InputOrderRow o={item} />}
          ListEmptyComponent={
            <EmptyState
              art="noOrders"
              title={tr('inputs.noOrdersTitle')}
              body={tr('inputs.noOrdersBody')}
              action={{ label: tr('inputs.shop'), onPress: () => setTab('shop') }}
            />
          }
        />
      )}
    </View>
  );
}

function InputCard({ p }: { p: InputProductListItemDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const stock = Number(p.stock);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/inputs/[id]', params: { id: p.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${kes(p.pricePerUnit)} ${tr('common.perUnit', { unit: unitLabel(p.unit) })}, ${p.supplierOrg.name}`}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.card,
        {
          borderRadius: t.radius.md,
          borderColor: t.colors.line,
          backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
        },
      ]}
    >
      <ProduceImage uri={p.photoUrls[0]} category="INPUT" size={76} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {p.name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {p.supplierOrg.name} · {p.county}
        </Text>
        <Text variant="bodyStrong" tone="brand" numeric>
          {kes(p.pricePerUnit)}
          <Text variant="caption" tone="tertiary">
            {' '}
            / {unitLabel(p.unit)}
          </Text>
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Pill label={tr(`inputs.cat.${p.category}`)} size="sm" />
          {p.isOrganic && <Pill label={tr('farms.organic')} tone="success" icon="leaf" size="sm" />}
          {stock <= 0 && <Pill label={tr('inputs.outOfStock')} tone="warning" size="sm" />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1, alignItems: 'center' },
});
