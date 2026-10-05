import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSession } from '../../data/session';
import { humanError } from '../../lib/errors';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Chip } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { CountyPicker } from '../../ui/Pickers';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { demoPortrait } from '../shop/components';
import { type FeaturedFarmer, useFarmerDirectory } from './data';
import { FarmerBadges } from './FarmerBadges';

/** All farmers (B06 featured list, up to 30) with a county filter. */
export function FarmersScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const home = me?.organizations[0]?.profile?.county ?? me?.user.county ?? undefined;
  const [county, setCounty] = useState<string | undefined>(undefined);
  const [pick, setPick] = useState(false);
  const list = useFarmerDirectory(county);
  const rows = list.data ?? [];
  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const gutter = size === 'compact' ? 20 : 32;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={tr('farmers.title')} subtitle={tr('farmers.subtitle')} />
      <FlatList
        key={`cols-${columns}`}
        data={rows}
        numColumns={columns}
        keyExtractor={(f) => f.id}
        columnWrapperStyle={columns > 1 ? { gap: 16 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 32,
          gap: 16,
          width: '100%',
          maxWidth: t.layout.contentMax + gutter * 2,
          alignSelf: 'center',
        }}
        refreshing={list.isRefetching}
        onRefresh={() => list.refetch()}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={tr('farmers.allCounties')} selected={!county} onPress={() => setCounty(undefined)} />
            {home && home !== county && (
              <Chip
                label={tr('farmers.near', { county: home })}
                icon="location"
                onPress={() => setCounty(home)}
              />
            )}
            <Chip
              label={county ?? tr('farmers.pickCounty')}
              icon="location"
              selected={!!county}
              onPress={() => setPick(true)}
            />
            <CountyPicker visible={pick} onClose={() => setPick(false)} value={county} onSelect={setCounty} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 / columns }}>
            <FarmerTile farmer={item} />
          </View>
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <View
              style={{ gap: 12 }}
              accessibilityRole="progressbar"
              accessibilityLabel={tr('common.loading')}
            >
              {['a', 'b', 'c'].map((k) => (
                <Skeleton key={k} height={120} radius={14} />
              ))}
            </View>
          ) : list.error ? (
            <ErrorState message={humanError(list.error)} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              art="noResults"
              title={tr('farmers.emptyTitle')}
              body={county ? tr('farmers.emptyCounty', { county }) : tr('farmers.emptyBody')}
              action={
                county ? { label: tr('farmers.allCounties'), onPress: () => setCounty(undefined) } : undefined
              }
            />
          )
        }
      />
    </View>
  );
}

function FarmerTile({ farmer: f }: { farmer: FeaturedFarmer }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const photo = f.photoUrl ?? f.avatarUrl;
  const src = photo ? { uri: photo } : demoPortrait(f.id);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/farmer/[id]', params: { id: f.id } })}
      accessibilityLabel={tr('farmers.tileLabel', { name: f.firstName, farm: f.farmName, county: f.county })}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.tile,
        {
          backgroundColor: pressed || hovered ? t.colors.surfaceMuted : t.colors.surface,
          borderRadius: t.radius.md,
          borderColor: t.colors.line,
        },
        t.scheme === 'light' && t.elevation.card,
      ]}
    >
      <View style={[styles.photo, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.sm }]}>
        {src ? (
          <Image
            source={src}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
        ) : (
          <Icon name="farm" size={32} color={t.colors.primary} weight="duotone" />
        )}
      </View>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text variant="headline" numberOfLines={1}>
          {f.farmName}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {tr('shop.by', { name: f.firstName })} · {f.county}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {f.rating !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="star" size={14} color={t.colors.star} weight="fill" />
              <Text variant="caption" numeric>
                {f.rating.toFixed(1)}
              </Text>
            </View>
          )}
          <Text variant="caption" tone="secondary" numeric>
            {tr('farmers.listings', { count: f.activeListings })}
          </Text>
          <Text variant="caption" tone="secondary" numeric>
            {tr('farmers.qa', { pct: Math.round(f.qaPassRate * 100) })}
          </Text>
        </View>
        <FarmerBadges badges={f.badges} max={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexDirection: 'row', gap: 14, padding: 12, borderWidth: 1, alignItems: 'center' },
  photo: { width: 96, height: 96, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
