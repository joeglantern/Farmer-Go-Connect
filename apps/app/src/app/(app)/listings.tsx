import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { ListingRow } from '../../features/farmer/components';
import { isLiveListing, useMyListings } from '../../features/farmer/data';
import { ListingDetail } from '../../features/farmer/ListingDetail';
import { produceName } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Controls';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';

type Scope = 'live' | 'upcoming' | 'closed';

/** My listings: live, upcoming and closed. Tablets and desktop show the listing beside the list. */
export default function Listings() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const q = useMyListings();
  const [scope, setScope] = useState<Scope>('live');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const split = size !== 'compact';

  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const buckets = useMemo(() => {
    const now = Date.now();
    const b: Record<Scope, typeof all> = { live: [], upcoming: [], closed: [] };
    for (const l of all) {
      if (!isLiveListing(l)) b.closed.push(l);
      else if (new Date(l.availableFrom).getTime() > now) b.upcoming.push(l);
      else b.live.push(l);
    }
    b.closed.sort((a, c) => new Date(c.availableTo).getTime() - new Date(a.availableTo).getTime());
    return b;
  }, [all]);
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return buckets[scope].filter(
      (l) => !s || produceName(l.produce).toLowerCase().includes(s) || l.farm.name.toLowerCase().includes(s),
    );
  }, [buckets, scope, search]);
  const current = split ? (selected ?? items[0]?.id ?? null) : null;

  const list = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, gap: 12, paddingBottom: 12 }}>
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSelected(null);
          }}
          options={[
            { value: 'live', label: tr('listings.live'), count: buckets.live.length || undefined },
            {
              value: 'upcoming',
              label: tr('listings.upcoming'),
              count: buckets.upcoming.length || undefined,
            },
            { value: 'closed', label: tr('listings.closedTab') },
          ]}
        />
        {all.length > 6 && (
          <SearchField value={search} onChangeText={setSearch} placeholder={tr('listings.search')} />
        )}
      </View>
      {q.isLoading ? (
        <View style={{ paddingHorizontal: 20 }}>
          <SkeletonList count={5} height={82} />
        </View>
      ) : q.error ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 10 }}
          refreshing={q.isRefetching}
          onRefresh={() => q.refetch()}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          renderItem={({ item }) => (
            <ListingRow
              listing={item}
              selected={item.id === current}
              onPress={() =>
                split
                  ? setSelected(item.id)
                  : router.push({ pathname: '/listings/[id]', params: { id: item.id } })
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={search ? tr('listings.noMatch') : tr(`listings.empty.${scope}`)}
              body={search ? undefined : tr('listings.emptyBody')}
              action={
                scope === 'closed' || search
                  ? undefined
                  : { label: tr('farmer.listProduce'), icon: 'plus', onPress: () => router.navigate('/sell') }
              }
            />
          }
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('tabs.listings')}
        large={!split}
        right={
          split ? (
            <Button
              label={tr('farmer.listProduce')}
              icon="plus"
              size="sm"
              fullWidth={false}
              onPress={() => router.navigate('/sell')}
            />
          ) : undefined
        }
      />
      {split ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: size === 'expanded' ? 420 : 340,
              borderRightWidth: 1,
              borderRightColor: t.colors.line,
            }}
          >
            {list}
          </View>
          <View style={{ flex: 1 }}>
            {current ? (
              <ListingDetail key={current} id={current} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="callout" tone="tertiary">
                  {tr('listings.pick')}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </View>
  );
}
