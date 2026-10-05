import type { ListingDto } from '@farmgo/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, View } from 'react-native';
import { useCart } from '../../../data/cart';
import { categoryBySlug, useSupply } from '../../../data/catalog';
import { useSession } from '../../../data/session';
import { ProductCard, ProductRow } from '../../../features/shop/components';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { IconButton } from '../../../ui/Button';
import { Chip } from '../../../ui/Controls';
import { Header } from '../../../ui/Screen';
import { SkeletonList } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { SearchField } from '../../../ui/TextField';

type Sort = 'nearest' | 'price_asc' | 'soonest';

/** Mockup screen 4: category listing with search, filter chips and "Add to Cart". */
export default function CategoryScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const cat = categoryBySlug(slug ?? 'all');
  const me = useSession((s) => s.me);
  const cartCount = useCart((s) => s.lines.length);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('nearest');
  const _county = me?.organizations[0]?.profile?.county ?? me?.user.county ?? undefined;

  const supply = useSupply({
    category: cat?.slug === 'all' ? undefined : cat?.slug,
    q: q.trim() || undefined,
    sort,
  });

  // The server filters by category, search text and sort (including distance). Only the
  // sub-filter chips inside a category (for example leafy greens vs herbs) run on the device.
  const items = useMemo(() => {
    const all = supply.data?.pages.flatMap((p) => p.items) ?? [];
    if (filter === 'all') return all;
    const sub = cat?.filters.find((f) => f.key === filter);
    const known = new Set(cat?.filters.flatMap((f) => f.produce));
    return all.filter((l: ListingDto) =>
      filter === 'others' ? !known.has(l.produce.category) : !!sub?.produce.includes(l.produce.category),
    );
  }, [supply.data, cat, filter]);

  const title = cat ? tr(cat.labelKey) : tr('catalog.cat.all');
  const wide = size !== 'compact';
  const gutter = wide ? 32 : 20;
  const columns = size === 'expanded' ? 4 : wide ? 3 : 1;

  const chips = [
    { key: 'all', label: tr('catalog.filter.all') },
    ...(cat?.filters.map((f) => ({ key: f.key, label: tr(f.labelKey) })) ?? []),
    ...(cat?.filters.length ? [{ key: 'others', label: tr('catalog.filter.others') }] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={title}
        right={
          <IconButton
            icon="cart"
            label={tr('shop.cart')}
            badge={cartCount}
            onPress={() => router.push('/cart')}
          />
        }
      />
      <View
        style={{
          paddingHorizontal: gutter,
          gap: 12,
          paddingBottom: 8,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
        }}
      >
        <SearchField value={q} onChangeText={setQ} placeholder={tr('home.searchPlaceholder')} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
        >
          {chips.map((c) => (
            <Chip key={c.key} label={c.label} selected={filter === c.key} onPress={() => setFilter(c.key)} />
          ))}
          <View style={{ width: 1, marginHorizontal: 4, backgroundColor: t.colors.line }} />
          {(
            [
              ['nearest', tr('shop.sortNearest')],
              ['price_asc', tr('shop.sortPrice')],
              ['soonest', tr('shop.sortSoonest')],
            ] as const
          ).map(([k, l]) => (
            <Chip
              key={k}
              label={l}
              icon={k === 'nearest' ? 'location' : k === 'price_asc' ? 'sort' : 'calendar'}
              selected={sort === k}
              onPress={() => setSort(k)}
            />
          ))}
        </ScrollView>
      </View>

      {supply.isLoading ? (
        <View style={{ paddingHorizontal: gutter, paddingTop: 8 }}>
          <SkeletonList count={5} height={112} />
        </View>
      ) : supply.error ? (
        <ErrorState onRetry={() => supply.refetch()} />
      ) : (
        <FlatList
          key={`cols-${columns}`}
          data={items}
          numColumns={columns}
          keyExtractor={(l) => l.id}
          columnWrapperStyle={columns > 1 ? { gap: 16 } : undefined}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: 8,
            paddingBottom: 40,
            gap: columns > 1 ? 16 : 12,
            width: '100%',
            maxWidth: t.layout.contentMax + gutter * 2,
            alignSelf: 'center',
          }}
          refreshing={supply.isRefetching}
          onRefresh={() => supply.refetch()}
          onEndReached={() => supply.hasNextPage && !supply.isFetchingNextPage && supply.fetchNextPage()}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) =>
            columns > 1 ? (
              <View style={{ flex: 1 / columns }}>
                <ProductCard listing={item} />
              </View>
            ) : (
              <ProductRow listing={item} />
            )
          }
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={q ? tr('shop.noMatchTitle', { q }) : tr('shop.emptyCategoryTitle', { category: title })}
              body={tr('shop.emptyCategoryBody')}
              action={
                me?.user.role === 'buyer'
                  ? {
                      label: tr('shop.postRequirement'),
                      icon: 'megaphone',
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
