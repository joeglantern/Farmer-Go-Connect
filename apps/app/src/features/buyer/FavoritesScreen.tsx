import { Image } from 'expo-image';
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { type CategorySlug, images } from '../../assets/registry';
import { type Favorite, type FavoriteKind, useFavoriteList, useFavorites } from '../../data/favorites';
import { humanError } from '../../lib/errors';
import { useSizeClass, useTheme } from '../../theme/theme';
import { IconButton } from '../../ui/Button';
import { Chip, Pill } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { demoPortrait } from '../shop/components';

type Filter = 'all' | FavoriteKind;
const FILTERS: Filter[] = ['all', 'LISTING', 'FARMER', 'PRODUCE', 'CATEGORY'];
const ICONS: Record<FavoriteKind, IconName> = {
  LISTING: 'basket',
  FARMER: 'farm',
  PRODUCE: 'leaf',
  CATEGORY: 'grid',
};

function hrefFor(f: Favorite): Href {
  switch (f.kind) {
    case 'LISTING':
      return { pathname: '/product/[id]', params: { id: f.targetId } };
    case 'FARMER':
      return { pathname: '/farmer/[id]', params: { id: f.targetId } };
    case 'CATEGORY':
      return { pathname: '/category/[slug]', params: { slug: f.targetId } };
    default:
      return { pathname: '/search', params: { q: f.title } };
  }
}

/** Saved produce, farmers, produce types and categories (B12). */
export function FavoritesScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const [filter, setFilter] = useState<Filter>('all');
  const list = useFavoriteList();
  const all = list.data ?? [];
  const rows = filter === 'all' ? all : all.filter((f) => f.kind === filter);
  const gutter = size === 'compact' ? 20 : 32;
  const columns = size === 'expanded' ? 2 : 1;
  const count = (k: Filter) => (k === 'all' ? all.length : all.filter((f) => f.kind === k).length);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('favorites.title')} />
      <FlatList
        key={`cols-${columns}`}
        data={rows}
        numColumns={columns}
        keyExtractor={(f) => f.id}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 32,
          gap: 12,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
        }}
        refreshing={list.isRefetching}
        onRefresh={() => list.refetch()}
        ListHeaderComponent={
          all.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {FILTERS.filter((k) => k === 'all' || count(k) > 0).map((k) => (
                <Chip
                  key={k}
                  label={tr(`favorites.tabs.${k}`)}
                  selected={filter === k}
                  onPress={() => setFilter(k)}
                  count={count(k)}
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 / columns }}>
            <FavoriteRow fav={item} />
          </View>
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <SkeletonList count={4} height={84} />
          ) : list.error ? (
            <ErrorState message={humanError(list.error)} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              art="noListings"
              title={tr('favorites.emptyTitle')}
              body={tr('favorites.emptyBody')}
              action={{ label: tr('cart.browse'), icon: 'search', onPress: () => router.push('/search') }}
            />
          )
        }
      />
    </View>
  );
}

function FavoriteRow({ fav: f }: { fav: Favorite }) {
  const { t: tr, i18n } = useTranslation();
  const t = useTheme();
  const toast = useToast();
  const toggle = useFavorites((s) => s.toggle);
  const title = i18n.language === 'sw' && f.titleSw ? f.titleSw : f.title;
  const art =
    f.kind === 'CATEGORY'
      ? images.categories[f.targetId as CategorySlug]
      : f.imageUrl
        ? { uri: f.imageUrl }
        : f.kind === 'FARMER'
          ? demoPortrait(f.targetId)
          : null;

  const remove = () => {
    toggle(f.kind, f.targetId);
    toast.show({
      message: tr('favorites.removedNamed', { name: title }),
      action: { label: tr('cart.undo'), onPress: () => toggle(f.kind, f.targetId) },
    });
  };

  return (
    <Pressable
      onPress={f.available ? () => router.push(hrefFor(f)) : undefined}
      disabled={!f.available}
      accessibilityLabel={[title, f.subtitle, f.available ? undefined : tr('favorites.unavailable')]
        .filter(Boolean)
        .join(', ')}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.row,
        {
          backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
          borderRadius: t.radius.md,
          borderColor: t.colors.line,
          opacity: f.available ? 1 : 0.6,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          { backgroundColor: t.colors.primaryTint, borderRadius: f.kind === 'FARMER' ? 32 : t.radius.sm },
        ]}
      >
        {art ? (
          <Image
            source={art}
            style={StyleSheet.absoluteFill}
            contentFit={f.kind === 'CATEGORY' ? 'contain' : 'cover'}
            contentPosition="top"
          />
        ) : (
          <Icon name={ICONS[f.kind]} size={26} color={t.colors.primary} weight="duotone" />
        )}
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        {f.subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {f.subtitle}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill label={tr(`favorites.kind.${f.kind}`)} tone="neutral" size="sm" icon={ICONS[f.kind]} />
          {!f.available && <Pill label={tr('favorites.unavailable')} tone="warning" size="sm" />}
        </View>
      </View>
      <IconButton
        icon="heart"
        filled
        color={t.colors.heart}
        label={tr('favorites.removeNamed', { name: title })}
        onPress={remove}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1 },
  thumb: { width: 64, height: 64, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
