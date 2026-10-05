import type { ListingDto } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { type Href, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, ScrollView, StyleSheet, View } from 'react-native';
import { images } from '../../assets/registry';
import { useCart } from '../../data/cart';
import type { APP_CATEGORIES, FeaturedFarmer } from '../../data/catalog';
import { kes, produceName, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { FieldArt, LeafPattern } from '../../ui/brand/Art';
import { Stepper } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';

/** "Kale (1 kg)" / "Kale (bunch)" as in the mockup. */
export function listingTitle(l: Pick<ListingDto, 'produce'>) {
  const u = unitLabel(l.produce.unit);
  return `${produceName(l.produce)} (${u === 'kg' ? '1 kg' : u})`;
}

function AddControl({ listing, compact }: { listing: ListingDto; compact?: boolean }) {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const inCart = useCart((s) => s.lines.find((x) => x.listingId === listing.id)?.quantity ?? 0);
  const add = useCart((s) => s.add);
  const setQuantity = useCart((s) => s.setQuantity);
  const max = Number(listing.quantityLeft);

  if (inCart > 0) {
    return (
      <Stepper
        value={inCart}
        onChange={(v) => setQuantity(listing.id, v)}
        min={0}
        max={max}
        size="sm"
        unit={unitLabel(listing.produce.unit, inCart)}
        label={tr('shop.quantityOf', { name: produceName(listing.produce) })}
      />
    );
  }
  return (
    <Button
      label={tr('shop.addToCart')}
      size="sm"
      fullWidth={false}
      disabled={max <= 0}
      onPress={() => {
        add(listing, 1);
        toast.show({
          message: tr('shop.added', { name: produceName(listing.produce) }),
          tone: 'success',
          action: { label: tr('shop.viewCart'), onPress: () => router.push('/cart') },
        });
      }}
      style={compact ? { paddingHorizontal: 12 } : undefined}
    />
  );
}

/** Mockup screen 4 list row. */
export function ProductRow({ listing }: { listing: ListingDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const photo = listing.photoUrls?.[0] ?? listing.produce.imageUrl;
  // The add control sits beside the card's tap area, not inside it: a button may not contain a button.
  return (
    <View>
      <Pressable
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: listing.id } })}
        accessibilityLabel={`${listingTitle(listing)}, ${listing.farm.county}, ${kes(listing.pricePerUnit)}`}
        focusRadius={t.radius.md}
        style={({ pressed, hovered }) => [
          styles.row,
          {
            backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
            borderRadius: t.radius.md,
          },
          t.scheme === 'light' && t.elevation.card,
        ]}
      >
        <ProduceImage
          uri={photo}
          category={listing.produce.category}
          produce={listing.produce}
          size={92}
          radius={t.radius.sm}
        />
        <View style={{ flex: 1, gap: 3, alignSelf: 'stretch' }}>
          <Text variant="headline" numberOfLines={1}>
            {listingTitle(listing)}
          </Text>
          <View style={styles.meta}>
            <Icon name="location" size={13} color={t.colors.primary} weight="fill" />
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {listing.distanceKm != null
                ? `${listing.farm.county} · ${tr('common.km', { km: listing.distanceKm })}`
                : listing.farm.county}
            </Text>
            {listing.farm.isOrganic && (
              <>
                <Text variant="caption" tone="tertiary">
                  ·
                </Text>
                <Text variant="caption" tone="leaf">
                  {tr('shop.organic')}
                </Text>
              </>
            )}
          </View>
          <View style={styles.rowBottom}>
            <Text variant="price" numeric>
              {kes(listing.pricePerUnit)}
            </Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.rowAdd}>
        <AddControl listing={listing} compact />
      </View>
    </View>
  );
}

/** Grid card for tablet and desktop. */
export function ProductCard({ listing }: { listing: ListingDto }) {
  const t = useTheme();
  const photo = listing.photoUrls?.[0] ?? listing.produce.imageUrl;
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: listing.id } })}
        accessibilityLabel={`${listingTitle(listing)}, ${listing.farm.county}, ${kes(listing.pricePerUnit)}`}
        focusRadius={t.radius.md}
        style={({ pressed, hovered }) => [
          styles.card,
          {
            backgroundColor: t.colors.surface,
            borderRadius: t.radius.md,
            transform: [{ translateY: hovered ? -2 : 0 }],
          },
          t.scheme === 'light' && (hovered ? t.elevation.raised : t.elevation.card),
          pressed && { opacity: 0.92 },
        ]}
      >
        <ProduceImage
          uri={photo}
          category={listing.produce.category}
          produce={listing.produce}
          style={{ width: '100%', aspectRatio: 4 / 3 }}
          radius={t.radius.sm}
        />
        <View style={{ gap: 3, paddingHorizontal: 4, paddingTop: 10 }}>
          <Text variant="headline" numberOfLines={1}>
            {listingTitle(listing)}
          </Text>
          <View style={styles.meta}>
            <Icon name="location" size={13} color={t.colors.primary} weight="fill" />
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {listing.farm.name} · {listing.farm.county}
            </Text>
          </View>
        </View>
        <View style={[styles.rowBottom, { paddingHorizontal: 4, paddingTop: 8 }]}>
          <Text variant="price" numeric>
            {kes(listing.pricePerUnit)}
          </Text>
        </View>
      </Pressable>
      <View style={styles.cardAdd}>
        <AddControl listing={listing} compact />
      </View>
    </View>
  );
}

/** Mockup home category circle. */
export function CategoryTile({ cat, size = 64 }: { cat: (typeof APP_CATEGORIES)[number]; size?: number }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const art = images.categories[cat.slug];
  return (
    <Pressable
      onPress={() =>
        cat.source === 'inputs'
          ? router.push('/inputs')
          : router.push({ pathname: '/category/[slug]', params: { slug: cat.slug } })
      }
      haptics="selection"
      accessibilityLabel={tr(cat.labelKey)}
      focusRadius={16}
      style={({ pressed }) => [styles.catTile, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.catCircle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.surface },
          t.scheme === 'light' ? t.elevation.card : { borderWidth: 1, borderColor: t.colors.line },
        ]}
      >
        {art ? (
          <Image
            source={art}
            style={{ width: size * 0.84, height: size * 0.84 }}
            contentFit="contain"
            transition={150}
          />
        ) : (
          <Icon name={cat.icon} size={size * 0.42} color={t.colors.primary} weight="duotone" />
        )}
      </View>
      <Text variant="caption" align="center" numberOfLines={3} style={{ maxWidth: size + 28 }}>
        {tr(cat.labelKey)}
      </Text>
    </Pressable>
  );
}

/** Stable demo portrait for a farmer without a profile photo yet (design/IMAGE_PROMPTS.md batch 6). */
export function demoPortrait(id: string) {
  const list = images.farmers;
  if (!list.length) return null;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return list[h % list.length] ?? null;
}

/** Mockup "Featured Farmers" card. */
export function FarmerCard({ farmer, width = 140 }: { farmer: FeaturedFarmer; width?: number }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/farmer/[id]', params: { id: farmer.id } })}
      accessibilityLabel={`${farmer.farmName}, ${farmer.county}`}
      focusRadius={t.radius.md}
      style={({ pressed }) => [{ width, gap: 8, opacity: pressed ? 0.85 : 1 }]}
    >
      <View
        style={{
          width,
          height: width * 0.86,
          borderRadius: t.radius.md,
          overflow: 'hidden',
          backgroundColor: t.colors.primaryTint,
        }}
      >
        {farmer.photoUrl || demoPortrait(farmer.id) ? (
          <Image
            source={farmer.photoUrl ? { uri: farmer.photoUrl } : demoPortrait(farmer.id)!}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
        ) : (
          <>
            <FieldArt dark={t.scheme === 'dark'} />
            <View style={styles.farmerBadge}>
              <Icon name="farm" size={18} color={t.colors.primary} weight="fill" />
            </View>
          </>
        )}
      </View>
      <View style={{ gap: 1 }}>
        <Text variant="calloutStrong" numberOfLines={1}>
          {farmer.farmName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {farmer.county}
          </Text>
          {!!farmer.ratingAvg && (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              accessible
              accessibilityLabel={tr('shop.ratedLabel', { rating: farmer.ratingAvg.toFixed(1) })}
            >
              <Text variant="caption" tone="secondary">
                {' · '}
              </Text>
              <Icon name="star" size={12} color={t.colors.warning} weight="fill" />
              <Text variant="caption" tone="secondary" numeric>
                {farmer.ratingAvg.toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Text variant="caption" tone="tertiary" numberOfLines={1} style={{ marginTop: -6 }}>
        {tr('shop.by', { name: farmer.firstName })}
      </Text>
    </Pressable>
  );
}

const SLIDES = [
  { titleKey: 'home.banner1Title', bodyKey: 'home.banner1Body' },
  { titleKey: 'home.banner2Title', bodyKey: 'home.banner2Body' },
  { titleKey: 'home.banner3Title', bodyKey: 'home.banner3Body' },
];

/** Mockup banner: "Fresh. Local. Sustainable." with paging dots. */
export function BannerCarousel({
  height = 150,
  slideHref,
}: {
  height?: number;
  /** Where each slide goes; a slide with no destination is not pressable. */
  slideHref?: (i: number) => Href | null;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const ref = useRef<ScrollView>(null);
  const userTouched = useRef(false);

  useEffect(() => {
    if (!width) return;
    const id = setInterval(() => {
      if (userTouched.current) return;
      setIndex((i) => {
        const next = (i + 1) % SLIDES.length;
        ref.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 6000);
    return () => clearInterval(id);
  }, [width]);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.band }}
      accessibilityRole="adjustable"
      accessibilityLabel={tr(SLIDES[index]!.titleKey)}
    >
      {width > 0 && (
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => {
            userTouched.current = true;
          }}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          scrollEventThrottle={16}
        >
          {SLIDES.map((s, i) => {
            const img = images.banners[i];
            const href = slideHref?.(i) ?? null;
            return (
              <Pressable
                key={s.titleKey}
                onPress={href ? () => router.push(href) : undefined}
                disabled={!href}
                accessibilityRole={href ? 'link' : undefined}
                focusRing={false}
                accessibilityLabel={tr(s.titleKey)}
                style={{ width, height }}
              >
                {img ? (
                  <Image
                    source={img}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    contentPosition="right"
                    transition={200}
                  />
                ) : (
                  <>
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.band }]} />
                    <LeafPattern opacity={0.12} />
                    <View style={[styles.bannerArt, { width: height * 1.1 }]}>
                      <FieldArt
                        dark
                        style={{
                          borderTopLeftRadius: height,
                          borderBottomLeftRadius: height,
                          overflow: 'hidden',
                        }}
                      />
                    </View>
                  </>
                )}
                <View style={styles.bannerText}>
                  <Text variant="title3" style={{ color: '#FFFFFF', maxWidth: '54%' }} numberOfLines={2}>
                    {tr(s.titleKey)}
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: 'rgba(255,255,255,0.9)', maxWidth: '52%' }}
                    numberOfLines={3}
                  >
                    {tr(s.bodyKey)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.dots} pointerEvents="none">
        {SLIDES.map((slide, i) => (
          <View
            key={slide.titleKey}
            style={[
              styles.dotBase,
              {
                width: i === index ? 18 : 6,
                backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, padding: 10, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 'auto',
  },
  card: { padding: 8, paddingBottom: 12, flex: 1 },
  rowAdd: { position: 'absolute', right: 10, bottom: 10 },
  cardAdd: { position: 'absolute', right: 12, bottom: 12 },
  catTile: { alignItems: 'center', gap: 8, minWidth: 72 },
  catCircle: { alignItems: 'center', justifyContent: 'center' },
  farmerBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerArt: { position: 'absolute', right: 0, top: 0, bottom: 0 },
  bannerText: { position: 'absolute', left: 18, top: 18, right: 18, gap: 6 },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dotBase: { height: 6, borderRadius: 3 },
});
