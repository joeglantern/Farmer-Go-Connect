import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { APP_CATEGORIES, useSupply } from '../../data/catalog';
import { humanError } from '../../lib/errors';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { ProductCard, ProductRow } from '../shop/components';

const RECENT_KEY = 'farmgo.recentSearches';
const SORTS = ['nearest', 'price_asc', 'price_desc', 'newest', 'soonest'] as const;
type Sort = (typeof SORTS)[number];
// Green inputs live in /v1/inputs, not supply, so that tile is not a search filter.
const CATEGORIES = APP_CATEGORIES.filter((c) => c.source === 'produce');

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Search listings (B05): fuzzy in English, Kiswahili and farm names, with filters and sort. */
export function SearchScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [organic, setOrganic] = useState(false);
  const [sort, setSort] = useState<Sort>('nearest');
  const [recent, setRecent] = useState<string[]>([]);
  const term = useDebounced(q.trim());
  const active = !!term || !!category || organic;

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((v) => {
        const parsed = v ? (JSON.parse(v) as unknown) : [];
        if (Array.isArray(parsed)) setRecent(parsed.filter((x): x is string => typeof x === 'string'));
      })
      .catch(() => undefined);
  }, []);

  const saveRecent = (value: string) => {
    const v = value.trim();
    if (v.length < 2) return;
    const next = [v, ...recent.filter((r) => r.toLowerCase() !== v.toLowerCase())].slice(0, 8);
    setRecent(next);
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const clearRecent = () => {
    setRecent([]);
    AsyncStorage.removeItem(RECENT_KEY).catch(() => undefined);
  };

  const results = useSupply({ q: term || undefined, category, organic: organic || undefined, sort }, active);
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const wide = size !== 'compact';
  const gutter = wide ? 32 : 20;
  const columns = size === 'expanded' ? 3 : 2;

  const filters = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.slug}
            label={tr(c.labelKey)}
            icon={c.icon}
            selected={category === c.slug}
            onPress={() => setCategory(category === c.slug ? undefined : c.slug)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, alignItems: 'center' }}
      >
        <Chip
          label={tr('search.organic')}
          icon="leaf"
          selected={organic}
          onPress={() => setOrganic((o) => !o)}
        />
        <View style={{ width: 1, height: 24, backgroundColor: t.colors.line, marginHorizontal: 4 }} />
        {SORTS.map((s) => (
          <Chip key={s} label={tr(`search.sort.${s}`)} selected={sort === s} onPress={() => setSort(s)} />
        ))}
      </ScrollView>
    </View>
  );

  const idle = (
    <View style={{ gap: 20, paddingTop: 8 }}>
      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={styles.rowBetween}>
            <Text variant="headline" accessibilityRole="header">
              {tr('search.recent')}
            </Text>
            <Button
              label={tr('search.clearRecent')}
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={clearRecent}
            />
          </View>
          {recent.map((r) => (
            <Pressable
              key={r}
              onPress={() => {
                setQ(r);
                saveRecent(r);
              }}
              accessibilityLabel={tr('search.searchFor', { term: r })}
              focusRadius={10}
              style={({ hovered, pressed }) => [
                styles.recentRow,
                { backgroundColor: hovered || pressed ? t.colors.surfaceMuted : 'transparent' },
              ]}
            >
              <Icon name="clock" size={18} color={t.colors.textTertiary} />
              <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                {r}
              </Text>
              <Icon name="chevronRight" size={16} color={t.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      )}
      <EmptyState art="noResults" compact title={tr('search.idleTitle')} body={tr('search.idleBody')} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('search.title')}
        right={
          <IconButton
            icon="farm"
            label={tr('search.browseFarmers')}
            onPress={() => router.push('/farmers')}
          />
        }
      />
      <View
        style={{
          paddingHorizontal: gutter,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
          gap: 12,
        }}
      >
        <SearchField
          value={q}
          onChangeText={setQ}
          onSubmit={() => saveRecent(q)}
          placeholder={tr('home.searchPlaceholder')}
          autoFocus={!params.category}
        />
        {filters}
      </View>
      <FlatList
        key={wide ? `grid-${columns}` : 'list'}
        data={active ? items : []}
        numColumns={wide ? columns : 1}
        keyExtractor={(l) => l.id}
        columnWrapperStyle={wide ? { gap: 16 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 32,
          gap: wide ? 16 : 12,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
        }}
        refreshing={active && results.isRefetching && !results.isFetchingNextPage}
        onRefresh={active ? () => results.refetch() : undefined}
        onEndReached={() => results.hasNextPage && !results.isFetchingNextPage && results.fetchNextPage()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => term && saveRecent(term)}
        renderItem={({ item }) =>
          wide ? (
            <View style={{ flex: 1 / columns }}>
              <ProductCard listing={item} />
            </View>
          ) : (
            <ProductRow listing={item} />
          )
        }
        ListHeaderComponent={
          active && !results.isLoading && items.length > 0 ? (
            <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
              {results.hasNextPage
                ? tr('search.manyResults', { count: items.length })
                : tr('search.results', { count: items.length })}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !active ? (
            idle
          ) : results.isLoading ? (
            <View
              style={{ gap: 12 }}
              accessibilityRole="progressbar"
              accessibilityLabel={tr('common.loading')}
            >
              {['a', 'b', 'c', 'd'].map((k) => (
                <Skeleton key={k} height={112} radius={14} />
              ))}
            </View>
          ) : results.error ? (
            <ErrorState message={humanError(results.error)} onRetry={() => results.refetch()} />
          ) : (
            <EmptyState
              art="noResults"
              title={tr('search.noneTitle', { term: term || tr('search.theseFilters') })}
              body={tr('search.noneBody')}
              action={{
                label: tr('search.postRequirement'),
                icon: 'repeat',
                onPress: () => router.push('/requirements/new'),
              }}
            />
          )
        }
        ListFooterComponent={
          results.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} /> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
});
