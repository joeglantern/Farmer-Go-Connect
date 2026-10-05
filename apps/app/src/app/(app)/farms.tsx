import type { FarmDto } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFarms } from '../../features/farmer/data';
import { FarmSheet } from '../../features/farmer/FarmSheet';
import { farmArt } from '../../features/farmer/farmArt';
import { qty } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

/** My farms: photo cards, add a farm, open one for its listings and map pin. */
export default function Farms() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const farms = useFarms();
  const [adding, setAdding] = useState(false);
  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const gutter = size === 'compact' ? 20 : 32;
  const list = (farms.data ?? []).slice().sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        title={tr('nav.farms')}
        large={size === 'compact'}
        right={
          list.length > 0 ? (
            <Button
              label={tr('farms.add')}
              icon="plus"
              size="sm"
              fullWidth={false}
              onPress={() => setAdding(true)}
            />
          ) : undefined
        }
      />
      {farms.isLoading ? (
        <View style={{ padding: gutter }}>
          <SkeletonList count={3} height={200} />
        </View>
      ) : farms.error ? (
        <ErrorState onRetry={() => farms.refetch()} />
      ) : (
        <FlatList
          key={columns}
          data={list}
          numColumns={columns}
          keyExtractor={(f) => f.id}
          columnWrapperStyle={columns > 1 ? { gap: 14 } : undefined}
          contentContainerStyle={{
            padding: gutter,
            paddingTop: 4,
            gap: 14,
            maxWidth: t.layout.contentMax,
            width: '100%',
            alignSelf: 'center',
          }}
          refreshing={farms.isRefetching}
          onRefresh={() => farms.refetch()}
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <FarmCard farm={item} />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              art="noResults"
              title={tr('farms.emptyTitle')}
              body={tr('farms.emptyBody')}
              action={{ label: tr('farms.add'), icon: 'plus', onPress: () => setAdding(true) }}
            />
          }
        />
      )}
      <FarmSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSaved={(f) => router.push({ pathname: '/farms/[id]', params: { id: f.id } })}
      />
    </View>
  );
}

function FarmCard({ farm }: { farm: FarmDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const art = farm.photoUrl ? { uri: farm.photoUrl } : farmArt(farm.id);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/farms/[id]', params: { id: farm.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${farm.name}, ${farm.county}`}
      focusRadius={t.radius.lg}
      style={({ pressed, hovered }) => [
        styles.card,
        {
          borderRadius: t.radius.lg,
          borderColor: t.colors.line,
          backgroundColor: t.colors.surface,
          opacity: farm.active ? 1 : 0.7,
        },
        (pressed || hovered) && { borderColor: t.colors.lineStrong },
      ]}
    >
      <View style={{ height: 130, backgroundColor: t.colors.primaryTint }}>
        {art ? (
          <Image source={art} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <Icon name="farm" size={40} color={t.colors.leaf} />
        )}
      </View>
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {farm.name}
          </Text>
          <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
        </View>
        <Text variant="callout" tone="secondary" numberOfLines={1}>
          {[farm.ward, farm.county].filter(Boolean).join(', ')}
          {farm.acreage ? ` · ${tr('farms.acres', { n: qty(farm.acreage) })}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {farm.isOrganic && <Pill label={tr('farms.organic')} tone="success" icon="leaf" size="sm" />}
          {farm.lat == null && <Pill label={tr('farms.noPin')} tone="warning" icon="location" size="sm" />}
          {!farm.active && <Pill label={tr('farms.inactive')} size="sm" />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: 1 },
});
