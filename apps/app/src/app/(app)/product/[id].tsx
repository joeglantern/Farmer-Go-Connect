import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { images } from '../../../assets/registry';
import { useCart } from '../../../data/cart';
import { useListing } from '../../../data/catalog';
import { useFavorites } from '../../../data/favorites';
import { listingTitle, ProductCard } from '../../../features/shop/components';
import { dateShort, kes, produceName, qty, unitLabel } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button, IconButton } from '../../../ui/Button';
import { Avatar, Card, Divider, Pill, Stepper, Tag } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { ProduceImage } from '../../../ui/Media';
import { useToast } from '../../../ui/overlays/Toast';
import { Pressable } from '../../../ui/Pressable';
import { Header, SectionTitle } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

/** Mockup screen 5: product detail. */
export default function ProductDetail() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(id);
  const l = listing.data;
  const inCart = useCart((s) => (id ? (s.lines.find((x) => x.listingId === id)?.quantity ?? 0) : 0));
  const add = useCart((s) => s.add);
  const setQuantity = useCart((s) => s.setQuantity);
  const [q, setQ] = useState(1);
  const fav = useFavorites((s) => (id ? s.has('LISTING', id) : false));
  const toggleFav = useFavorites((s) => s.toggle);
  const similarItems = (l?.similar ?? []).slice(0, 4);
  const tags = new Set(l?.tags ?? []);

  if (listing.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Skeleton height={320} radius={0} />
        <View style={{ padding: 20, gap: 12 }}>
          <Skeleton width="60%" height={26} />
          <Skeleton width="30%" height={16} />
          <Skeleton width="40%" height={30} />
          <Skeleton height={80} />
        </View>
      </View>
    );
  }
  if (listing.error || !l) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header />
        <ErrorState onRetry={() => listing.refetch()} />
      </View>
    );
  }

  const photo = l.photoUrls?.[0] ?? l.produce.imageUrl;
  const max = Number(l.quantityLeft);
  const unit = unitLabel(l.produce.unit);
  const upcoming = new Date(l.availableFrom) > new Date();
  const wide = size !== 'compact';
  const farmer = l.farm.farmer;

  const onAdd = () => {
    if (inCart > 0) {
      setQuantity(l.id, q);
    } else {
      add(l, q);
    }
    toast.show({
      message: tr('shop.added', { name: produceName(l.produce) }),
      tone: 'success',
      action: { label: tr('shop.viewCart'), onPress: () => router.push('/cart') },
    });
  };

  const media = (
    <View style={[wide ? { flex: 1, borderRadius: t.radius.xl, overflow: 'hidden' } : { height: 320 }]}>
      <ProduceImage
        uri={photo}
        category={l.produce.category}
        produce={l.produce}
        radius={0}
        style={StyleSheet.absoluteFill}
        accessibilityLabel={listingTitle(l)}
      />
      {!wide && (
        <View style={[styles.overlay, { top: insets.top + 8 }]}>
          <IconButton
            icon="back"
            label={tr('common.back')}
            variant="onPhoto"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          />
          <IconButton
            icon="heart"
            filled={fav}
            label={fav ? tr('shop.unfavorite') : tr('shop.favorite')}
            variant="onPhoto"
            color={fav ? t.colors.heart : undefined}
            onPress={() => {
              const on = toggleFav('LISTING', l.id);
              toast.show(on ? tr('shop.savedFavorite') : tr('shop.removedFavorite'));
            }}
          />
        </View>
      )}
    </View>
  );

  const details = (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Text variant="title2" style={{ flex: 1 }} accessibilityRole="header">
            {listingTitle(l)}
          </Text>
          {wide && (
            <IconButton
              icon="heart"
              filled={fav}
              label={fav ? tr('shop.unfavorite') : tr('shop.favorite')}
              variant="tinted"
              color={fav ? t.colors.heart : t.colors.primary}
              onPress={() => {
                const on = toggleFav('LISTING', l.id);
                toast.show(on ? tr('shop.savedFavorite') : tr('shop.removedFavorite'));
              }}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="location" size={15} color={t.colors.primary} weight="fill" />
          <Text variant="callout" tone="secondary">
            {l.farm.county}
            {l.farm.ward ? `, ${l.farm.ward}` : ''}
            {l.distanceKm != null ? ` · ${tr('common.km', { km: l.distanceKm })}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <Text variant="priceLarge" numeric>
            {kes(l.pricePerUnit)}
          </Text>
          <Text variant="callout" tone="tertiary">
            {tr('common.perUnit', { unit })}
          </Text>
        </View>
        {l.priceIndex ? (
          <Text variant="caption" tone={l.priceIndex.diffPct <= 0 ? 'success' : 'secondary'}>
            {Math.abs(l.priceIndex.diffPct) < 1
              ? tr('shop.priceAtMarket', { county: l.priceIndex.county })
              : l.priceIndex.diffPct < 0
                ? tr('shop.priceBelow', { pct: Math.abs(l.priceIndex.diffPct), county: l.priceIndex.county })
                : tr('shop.priceAbove', { pct: l.priceIndex.diffPct, county: l.priceIndex.county })}
          </Text>
        ) : null}
      </View>

      <Text variant="body" tone="secondary">
        {l.notes ??
          tr('shop.defaultDescription', { name: produceName(l.produce).toLowerCase(), farm: l.farm.name })}
      </Text>

      <View style={styles.tags}>
        {tags.has('fresh') && <Tag label={tr('shop.tagFresh')} icon="leaf" badge={images.badges.youthLed} />}
        {tags.has('organic') && (
          <Tag label={tr('shop.organic')} icon="sprout" badge={images.badges.organic} />
        )}
        {tags.has('local') && <Tag label={tr('shop.tagLocal')} icon="location" badge={images.badges.local} />}
        {l.grade && (
          <Tag
            label={tr('shop.grade', { grade: l.grade })}
            icon="shield"
            badge={images.badges.qualityChecked}
          />
        )}
      </View>

      <Card style={{ gap: 12 }}>
        <View style={styles.kv}>
          <Icon name={upcoming ? 'calendar' : 'checkCircle'} size={20} color={t.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="calloutStrong">
              {upcoming
                ? tr('shop.harvestFrom', { date: dateShort(l.availableFrom) })
                : tr('shop.availableNow')}
            </Text>
            <Text variant="caption" tone="secondary">
              {tr('shop.availableUntil', { date: dateShort(l.availableTo) })}
            </Text>
          </View>
          <Pill
            label={tr('shop.left', { qty: qty(max), unit: unitLabel(l.produce.unit, max) })}
            tone={max > 0 ? 'brand' : 'danger'}
          />
        </View>
      </Card>

      <Pressable
        onPress={() => router.push({ pathname: '/farmer/[id]', params: { id: farmer.id } })}
        accessibilityLabel={tr('shop.viewFarm', { farm: l.farm.name })}
        focusRadius={t.radius.md}
        style={({ pressed }) => [
          styles.farmer,
          {
            backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
            borderRadius: t.radius.md,
            borderColor: t.colors.line,
          },
        ]}
      >
        <Avatar name={l.farm.name} uri={l.farm.photoUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{l.farm.name}</Text>
          <Text variant="caption" tone="secondary">
            {tr('shop.farmerLine', {
              name: farmer.user.name,
              orders: farmer.ordersCompleted,
              qa: Math.round(farmer.qaPassRate * 100),
            })}
          </Text>
        </View>
        {farmer.ratingAvg != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="star" size={16} color={t.colors.star} weight="fill" />
            <Text variant="calloutStrong" numeric>
              {farmer.ratingAvg.toFixed(1)}
            </Text>
          </View>
        )}
        <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
      </Pressable>

      <View style={{ alignItems: 'center', gap: 16, marginTop: 4 }}>
        <Stepper
          value={q}
          onChange={setQ}
          min={1}
          max={Math.max(1, max)}
          size="lg"
          unit={unit}
          label={tr('shop.quantityOf', { name: produceName(l.produce) })}
        />
        <Button
          label={inCart > 0 ? tr('shop.updateCart') : tr('shop.addToCart')}
          icon="cart"
          onPress={onAdd}
          disabled={max <= 0}
          haptics="success"
        />
        {max <= 0 && (
          <Text variant="caption" tone="danger">
            {tr('shop.soldOut')}
          </Text>
        )}
      </View>
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header title={listingTitle(l)} />
        <ScrollView
          contentContainerStyle={{
            padding: 32,
            paddingTop: 8,
            gap: 32,
            maxWidth: t.layout.contentMax,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', gap: 40, minHeight: 440 }}>
            {media}
            <View style={{ flex: 1, maxWidth: 520 }}>{details}</View>
          </View>
          {similarItems.length > 0 && (
            <View>
              <SectionTitle title={tr('shop.similar')} />
              <View style={{ flexDirection: 'row', gap: 16 }}>
                {similarItems.map((s) => (
                  <View key={s.id} style={{ flex: 1 }}>
                    <ProductCard listing={s} />
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {media}
        <View style={[styles.sheet, { backgroundColor: t.colors.surface }]}>{details}</View>
        {similarItems.length > 0 && (
          <View style={{ paddingHorizontal: 20 }}>
            <Divider />
            <SectionTitle title={tr('shop.similar')} />
            <View style={{ gap: 12 }}>
              {similarItems.map((s) => (
                <ProductCard key={s.id} listing={s} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheet: { marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 24 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  farmer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
});
