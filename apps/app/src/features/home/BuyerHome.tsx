import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBadges } from '../../data/badges';
import { useCart } from '../../data/cart';
import { APP_CATEGORIES, useFeaturedFarmers, useSupply } from '../../data/catalog';
import { useSession } from '../../data/session';
import { useSizeClass, useTheme } from '../../theme/theme';
import { IconButton } from '../../ui/Button';
import { Avatar } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { SectionTitle } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';
import { BannerCarousel, CategoryTile, FarmerCard, ProductCard, ProductRow } from '../shop/components';

/** Mockup screen 3 (and screen 10's dashboard for business buyers). */
export function BuyerHome() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const cartCount = useCart((s) => s.lines.length);
  const org = me?.organizations[0];
  // Households and personal buyers get the shop home without the business band.
  const category = org?.profile?.buyerCategory;
  const isBusiness = !!org && !!category && category !== 'HOUSEHOLD' && category !== 'OTHER';
  const county = org?.profile?.county ?? me?.user.county ?? undefined;

  const badges = useBadges();
  const farmers = useFeaturedFarmers(county);
  // Nearest by distance from the buyer's default address or business (B05), not by county.
  const fresh = useSupply({ sort: 'nearest' });
  const listings = fresh.data?.pages.flatMap((p) => p.items) ?? [];
  const wide = size !== 'compact';
  const gutter = wide ? 32 : 20;
  const columns = size === 'expanded' ? 3 : 2;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 10, paddingHorizontal: gutter }]}>
      <Pressable
        onPress={() => router.push('/addresses')}
        accessibilityLabel={tr('home.deliverTo', { place: org?.profile?.town ?? county ?? '' })}
        style={styles.location}
        focusRadius={10}
      >
        <Icon name="location" size={20} color={t.colors.primary} weight="fill" />
        <View>
          <Text variant="caption" tone="tertiary">
            {tr('home.deliverToLabel')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="headline" numberOfLines={1}>
              {org?.profile?.town ?? county ?? tr('home.setLocation')}
            </Text>
            <Icon name="chevronDown" size={16} color={t.colors.textSecondary} />
          </View>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton
          icon="cart"
          label={tr('shop.cart')}
          badge={cartCount}
          onPress={() => router.push('/cart')}
        />
        <IconButton
          icon="bell"
          label={tr('home.notifications')}
          badge={badges.profile}
          onPress={() => router.push('/notifications')}
        />
        {size === 'compact' && (
          <Pressable
            onPress={() => router.navigate('/profile')}
            accessibilityLabel={tr('tabs.profile')}
            focusRadius={22}
            style={{ marginLeft: 4 }}
          >
            <Avatar name={me?.user.name} uri={me?.user.imageUrl} size={38} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <FlatList
        data={wide ? [] : listings}
        key={wide ? 'wide' : 'narrow'}
        keyExtractor={(l) => l.id}
        refreshing={fresh.isRefetching}
        onRefresh={() => {
          void fresh.refetch();
          void farmers.refetch();
        }}
        onEndReached={() => fresh.hasNextPage && !fresh.isFetchingNextPage && fresh.fetchNextPage()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: gutter }}>
            <ProductRow listing={item} />
          </View>
        )}
        ListHeaderComponent={
          <View style={{ width: '100%', maxWidth: t.layout.contentMax, alignSelf: 'center' }}>
            {header}
            <View style={{ paddingHorizontal: gutter, gap: 16 }}>
              <SearchField
                placeholder={tr('home.searchPlaceholder')}
                onPress={() => router.push('/search')}
              />
              <BannerCarousel
                height={wide ? 190 : 150}
                slideHref={(i) =>
                  i === 0 ? '/farmers' : i === 1 ? (isBusiness ? '/requirements/new' : null) : '/help'
                }
              />

              <SectionTitle title={tr('home.categories')} />
              {wide ? (
                <View style={styles.catRow}>
                  {APP_CATEGORIES.map((c) => (
                    <CategoryTile key={c.slug} cat={c} size={72} />
                  ))}
                </View>
              ) : (
                <View style={styles.catGrid}>
                  {APP_CATEGORIES.map((c) => (
                    <View key={c.slug} style={{ width: '25%', alignItems: 'center', marginBottom: 14 }}>
                      <CategoryTile cat={c} size={60} />
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={{ paddingHorizontal: gutter }}>
              <SectionTitle
                title={tr('home.featuredFarmers')}
                action={tr('common.viewAll')}
                onAction={() => router.push('/farmers')}
              />
            </View>
            {farmers.isLoading ? (
              <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: gutter }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={{ gap: 8 }}>
                    <Skeleton width={140} height={120} radius={14} />
                    <Skeleton width={100} height={14} />
                  </View>
                ))}
              </View>
            ) : farmers.error ? (
              <View style={{ paddingHorizontal: gutter }}>
                <ErrorState compact onRetry={() => farmers.refetch()} />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingHorizontal: gutter }}
              >
                {(farmers.data ?? []).map((f) => (
                  <FarmerCard key={f.id} farmer={f} width={wide ? 170 : 132} />
                ))}
              </ScrollView>
            )}

            <View style={{ paddingHorizontal: gutter }}>
              <SectionTitle
                title={county ? tr('home.freshNear', { county }) : tr('home.freshToday')}
                action={tr('common.seeAll')}
                onAction={() => router.push({ pathname: '/category/[slug]', params: { slug: 'all' } })}
              />
              {fresh.isLoading && (
                <View style={{ gap: 12 }}>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} height={112} radius={14} />
                  ))}
                </View>
              )}
              {fresh.error && <ErrorState onRetry={() => fresh.refetch()} />}
              {!fresh.isLoading && !fresh.error && listings.length === 0 && (
                <EmptyState
                  art="noResults"
                  title={tr('home.noProduceTitle')}
                  body={tr('home.noProduceBody')}
                />
              )}
              {wide && listings.length > 0 && (
                <View style={[styles.grid, { gap: 16 }]}>
                  {listings.map((l) => (
                    <View key={l.id} style={{ width: `${100 / columns - 2}%`, flexGrow: 1 }}>
                      <ProductCard listing={l} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    gap: 12,
  },
  location: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  catRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
