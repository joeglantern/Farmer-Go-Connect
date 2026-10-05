import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { produceArt } from '../../assets/registry';
import { useFavorites } from '../../data/favorites';
import { humanError } from '../../lib/errors';
import { dateShort, kes, produceName, qty, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { IconButton } from '../../ui/Button';
import { Card, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen, SectionTitle } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { demoPortrait } from '../shop/components';
import { type PublicFarmer, usePublicFarmer } from './data';
import { FarmerBadges } from './FarmerBadges';

/** Public farmer profile (B06): track record, badges, farms and what they are selling now. */
export function FarmerProfileScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const farmer = usePublicFarmer(id);
  const saved = useFavorites((s) => s.keys.includes(`FARMER:${id}`));
  const toggle = useFavorites((s) => s.toggle);
  const f = farmer.data;

  const fav = f ? (
    <IconButton
      icon="heart"
      filled={saved}
      label={
        saved
          ? tr('favorites.removeFarmer', { name: f.firstName })
          : tr('favorites.saveFarmer', { name: f.firstName })
      }
      onPress={() => {
        const on = toggle('FARMER', id);
        toast.show({
          message: on
            ? tr('favorites.savedFarmer', { name: f.firstName })
            : tr('favorites.removedFarmer', { name: f.firstName }),
          tone: on ? 'success' : 'default',
        });
      }}
    />
  ) : undefined;

  return (
    <Screen
      header={<Header title={f?.farms[0]?.name ?? tr('farmers.profile')} right={fav} />}
      refreshing={farmer.isRefetching}
      onRefresh={() => farmer.refetch()}
    >
      {farmer.isLoading ? (
        <View style={{ gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={tr('common.loading')}>
          <Skeleton height={220} radius={18} />
          <Skeleton height={90} radius={14} />
          <Skeleton height={140} radius={14} />
        </View>
      ) : farmer.error || !f ? (
        <ErrorState
          message={
            (farmer.error as { status?: number } | null)?.status === 404
              ? tr('farmers.notFound')
              : humanError(farmer.error)
          }
          onRetry={() => farmer.refetch()}
        />
      ) : (
        <Body farmer={f} />
      )}
    </Screen>
  );
}

function Body({ farmer: f }: { farmer: PublicFarmer }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const wide = size !== 'compact';
  const farm = f.farms[0];
  const cover = farm?.photoUrl ?? f.avatarUrl;
  const src = cover ? { uri: cover } : demoPortrait(f.id);

  const hero = (
    <View style={{ gap: 14 }}>
      <View
        style={[
          styles.cover,
          { borderRadius: t.radius.lg, backgroundColor: t.colors.primaryTint, height: wide ? 300 : 220 },
        ]}
      >
        {src ? (
          <Image
            source={src}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
        ) : (
          <Icon name="farm" size={48} color={t.colors.primary} weight="duotone" />
        )}
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="title2" accessibilityRole="header">
          {f.firstName}
        </Text>
        <Text variant="callout" tone="secondary">
          {f.farms.map((x) => `${x.name}, ${x.ward ? `${x.ward}, ` : ''}${x.county}`).join(' · ')}
        </Text>
        <Text variant="caption" tone="tertiary">
          {tr('farmers.memberSince', { date: dateShort(f.memberSince) })}
        </Text>
      </View>
      <FarmerBadges badges={f.badges} />
    </View>
  );

  const stats = (
    <View style={styles.stats}>
      {[
        {
          label: tr('farmers.rating'),
          value: f.rating !== null ? `${f.rating.toFixed(1)}` : tr('farmers.noRating'),
          hint: f.ratingsCount ? tr('farmers.ratings', { count: f.ratingsCount }) : undefined,
          icon: 'star' as const,
        },
        { label: tr('farmers.orders'), value: String(f.ordersCompleted), icon: 'orders' as const },
        { label: tr('farmers.qaPass'), value: `${Math.round(f.qaPassRate * 100)}%`, icon: 'shield' as const },
        { label: tr('farmers.onTime'), value: `${Math.round(f.onTimeRate * 100)}%`, icon: 'clock' as const },
      ].map((s) => (
        <Card key={s.label} style={{ flex: 1, minWidth: 130, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon
              name={s.icon}
              size={16}
              color={s.icon === 'star' ? t.colors.star : t.colors.primary}
              weight="fill"
            />
            <Text variant="caption" tone="secondary">
              {s.label}
            </Text>
          </View>
          <Text variant="statNumber" numeric>
            {s.value}
          </Text>
          {s.hint ? (
            <Text variant="caption" tone="tertiary">
              {s.hint}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );

  const listings = (
    <View>
      <SectionTitle title={tr('farmers.sellingNow')} />
      {f.activeListings.length === 0 ? (
        <EmptyState
          art="noListings"
          compact
          title={tr('farmers.noListingsTitle')}
          body={tr('farmers.noListingsBody')}
          action={{
            label: tr('search.postRequirement'),
            icon: 'repeat',
            onPress: () => router.push('/requirements/new'),
          }}
        />
      ) : (
        <View style={{ gap: 10 }}>
          {f.activeListings.map((l) => {
            const photo = l.photoUrls[0] ?? l.produce.imageUrl;
            const art = produceArt({ name: l.produce.name });
            return (
              <Pressable
                key={l.id}
                onPress={() => router.push({ pathname: '/product/[id]', params: { id: l.id } })}
                accessibilityLabel={tr('farmers.listingLabel', {
                  name: produceName(l.produce),
                  price: kes(l.pricePerUnit),
                  unit: unitLabel(l.produce.unit),
                })}
                focusRadius={t.radius.md}
                style={({ pressed, hovered }) => [
                  styles.listing,
                  {
                    backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
                    borderRadius: t.radius.md,
                    borderColor: t.colors.line,
                  },
                ]}
              >
                {photo || !art ? (
                  <ProduceImage uri={photo} size={64} radius={t.radius.sm} />
                ) : (
                  <Image
                    source={art}
                    style={{ width: 64, height: 64, borderRadius: t.radius.sm }}
                    contentFit="cover"
                  />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline" numberOfLines={1}>
                    {produceName(l.produce)}
                  </Text>
                  <Text variant="caption" tone="secondary" numeric>
                    {tr('farmers.left', {
                      qty: qty(l.quantityLeft),
                      unit: unitLabel(l.produce.unit, l.quantityLeft),
                    })}
                    {l.grade ? ` · ${tr('farmers.grade', { grade: l.grade })}` : ''}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {tr('farmers.availableFrom', { date: dateShort(l.availableFrom) })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text variant="price" numeric>
                    {kes(l.pricePerUnit)}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {tr('common.perUnit', { unit: unitLabel(l.produce.unit) })}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  const farms =
    f.farms.length > 1 ? (
      <View>
        <SectionTitle title={tr('farmers.farms')} />
        <View style={{ gap: 8 }}>
          {f.farms.map((x) => (
            <View key={x.id} style={styles.farmRow}>
              <Icon name="farm" size={18} color={t.colors.primary} />
              <Text variant="body" style={{ flex: 1 }}>
                {x.name}
              </Text>
              <Text variant="caption" tone="secondary">
                {x.county}
              </Text>
              {x.isOrganic && <Pill label={tr('shop.organic')} tone="success" size="sm" />}
            </View>
          ))}
        </View>
      </View>
    ) : null;

  if (wide) {
    return (
      <View style={{ flexDirection: 'row', gap: 28, alignItems: 'flex-start', paddingTop: 4 }}>
        <View style={{ flex: 1, gap: 20 }}>
          {hero}
          {stats}
          {farms}
        </View>
        <View style={{ flex: 1.2 }}>{listings}</View>
      </View>
    );
  }
  return (
    <View style={{ gap: 20, paddingTop: 4 }}>
      {hero}
      {stats}
      {listings}
      {farms}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  listing: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1 },
  farmRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
});
