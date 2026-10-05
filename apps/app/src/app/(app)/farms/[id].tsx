import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListingRow } from '../../../features/farmer/components';
import { useFarm, useSaveFarm } from '../../../features/farmer/data';
import { FarmSheet } from '../../../features/farmer/FarmSheet';
import { farmArt } from '../../../features/farmer/farmArt';
import LeafletMap from '../../../features/maps/LeafletMap';
import { humanError } from '../../../lib/errors';
import { qty } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Pill } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, SectionTitle } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

/** One farm: photo, location pin, size, organic status and its listings. */
export default function FarmScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFarm(id);
  const save = useSaveFarm(id);
  const [editing, setEditing] = useState(false);

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header />
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton height={200} radius={16} />
          <Skeleton height={120} radius={14} />
        </View>
      </View>
    );
  }
  if (q.error || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header />
        <ErrorState onRetry={() => q.refetch()} message={q.error ? humanError(q.error) : undefined} />
      </View>
    );
  }
  const f = q.data;
  const art = f.photoUrl ? { uri: f.photoUrl } : farmArt(f.id);
  const wide = size !== 'compact';

  const toggleActive = async () => {
    const ok = await dialog.confirm(
      f.active
        ? {
            title: tr('farms.deactivateTitle'),
            message: tr('farms.deactivateBody'),
            confirmLabel: tr('farms.deactivate'),
            destructive: true,
          }
        : {
            title: tr('farms.activateTitle'),
            message: tr('farms.activateBody'),
            confirmLabel: tr('farms.activate'),
          },
    );
    if (!ok) return;
    try {
      await save.mutateAsync({ active: !f.active });
      toast.success(f.active ? tr('farms.deactivated') : tr('farms.activated'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const info = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {f.isOrganic && <Pill label={tr('farms.organic')} tone="success" icon="leaf" size="sm" />}
        {!f.active && <Pill label={tr('farms.inactive')} size="sm" />}
      </View>
      <Row
        icon="location"
        label={tr('farms.location')}
        value={[f.ward, f.county].filter(Boolean).join(', ')}
      />
      {f.acreage != null && (
        <Row icon="scale" label={tr('farms.acreage')} value={tr('farms.acres', { n: qty(f.acreage) })} />
      )}
      <Row
        icon="star"
        label={tr('farms.trackRecord')}
        value={tr('farms.record', {
          orders: f.farmer.ordersCompleted,
          qa: Math.round(f.farmer.qaPassRate * 100),
        })}
      />
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <Button
          label={tr('common.edit')}
          icon="edit"
          variant="outline"
          size="md"
          fullWidth={false}
          onPress={() => setEditing(true)}
        />
        <Button
          label={f.active ? tr('farms.deactivate') : tr('farms.activate')}
          variant="ghost"
          size="md"
          fullWidth={false}
          onPress={toggleActive}
          loading={save.isPending}
        />
      </View>
    </Card>
  );

  const map =
    f.lat != null && f.lng != null ? (
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line }}>
        <LeafletMap
          markers={[{ id: f.id, lat: f.lat, lng: f.lng, kind: 'farm', label: f.name }]}
          dark={t.scheme === 'dark'}
          height={wide ? 280 : 200}
          zoom={14}
          dom={{ scrollEnabled: false, matchContents: true }}
        />
      </View>
    ) : (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="location" size={24} color={t.colors.warning} />
        <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
          {tr('farms.pinMissing')}
        </Text>
        <Button label={tr('farms.addPin')} size="sm" fullWidth={false} onPress={() => setEditing(true)} />
      </Card>
    );

  const listings = (
    <View>
      <SectionTitle title={tr('farms.listings')} />
      {f.listings.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 20 }}>
          <Text variant="callout" tone="secondary" align="center">
            {tr('farms.noListings')}
          </Text>
          <Button
            label={tr('farmer.listProduce')}
            icon="plus"
            size="md"
            fullWidth={false}
            onPress={() => router.navigate({ pathname: '/sell', params: { farmId: f.id } })}
          />
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {f.listings.map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              onPress={() => router.push({ pathname: '/listings/[id]', params: { id: l.id } })}
            />
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={f.name} subtitle={f.county} />
      <ScrollView
        contentContainerStyle={{
          padding: wide ? 32 : 20,
          paddingTop: 4,
          paddingBottom: insets.bottom + 40,
          gap: 16,
          maxWidth: t.layout.contentMax,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {art && (
          <View
            style={{
              height: wide ? 220 : 170,
              borderRadius: t.radius.lg,
              overflow: 'hidden',
              backgroundColor: t.colors.primaryTint,
            }}
          >
            <Image
              source={art}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              accessibilityLabel={f.name}
            />
          </View>
        )}
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 16 }}>
              {info}
              {map}
            </View>
            <View style={{ flex: 1.2 }}>{listings}</View>
          </View>
        ) : (
          <>
            {info}
            {map}
            {listings}
          </>
        )}
      </ScrollView>
      <FarmSheet
        visible={editing}
        onClose={() => setEditing(false)}
        farm={f}
        onDeleted={() => router.replace('/farms')}
      />
    </View>
  );
}

function Row({ icon, label, value }: { icon: 'location' | 'scale' | 'star'; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={18} color={t.colors.textTertiary} />
      <Text variant="callout" tone="secondary" style={{ width: 110 }}>
        {label}
      </Text>
      <Text variant="callout" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}
