import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/theme';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';
import { pickPhoto, type UploadBucket, uploadPhoto } from './upload';

export interface UploadedPhoto {
  key: string;
  uri: string;
}

/**
 * Evidence photos: tiles for each uploaded photo plus camera and gallery buttons. Each photo
 * uploads as soon as it is taken so submitting later is instant.
 */
export function PhotoStrip({
  bucket,
  photos,
  onChange,
  max = 10,
  size = 84,
}: {
  bucket: UploadBucket;
  photos: UploadedPhoto[];
  onChange: (next: UploadedPhoto[]) => void;
  max?: number;
  size?: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const native = Platform.OS !== 'web';

  const add = async (source: 'camera' | 'library') => {
    const picked = await pickPhoto(source);
    if (picked === null) return;
    if (picked === 'denied') {
      toast.error(source === 'camera' ? tr('qa.cameraDenied') : tr('qa.galleryDenied'));
      return;
    }
    setBusy(true);
    try {
      const key = await uploadPhoto(bucket, picked);
      onChange([...photos, { key, uri: picked.uri }]);
    } catch (err) {
      toast.error(humanError(err), { label: tr('common.retry'), onPress: () => void add(source) });
    } finally {
      setBusy(false);
    }
  };

  const full = photos.length >= max;
  const tile = { width: size, height: size, borderRadius: t.radius.sm };

  return (
    <View style={styles.wrap}>
      {photos.map((p, i) => (
        <View key={p.key} style={[tile, { overflow: 'hidden', backgroundColor: t.colors.surfaceMuted }]}>
          <Image
            source={{ uri: p.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={tr('qa.photoN', { n: i + 1 })}
          />
          <IconButton
            icon="close"
            label={tr('qa.removePhoto')}
            variant="onPhoto"
            size={28}
            iconSize={14}
            onPress={() => onChange(photos.filter((x) => x.key !== p.key))}
            style={styles.remove}
          />
        </View>
      ))}
      {busy && (
        <View style={[tile, styles.center, { backgroundColor: t.colors.primaryTint }]}>
          <ActivityIndicator color={t.colors.primary} />
        </View>
      )}
      {!full && !busy && (
        <>
          {native && (
            <AddTile
              icon="camera"
              label={tr('qa.takePhoto')}
              size={size}
              onPress={() => void add('camera')}
            />
          )}
          <AddTile
            icon="image"
            label={native ? tr('qa.fromGallery') : tr('qa.addPhoto')}
            size={size}
            onPress={() => void add('library')}
          />
        </>
      )}
    </View>
  );
}

function AddTile({
  icon,
  label,
  size,
  onPress,
}: {
  icon: 'camera' | 'image';
  label: string;
  size: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      focusRadius={t.radius.sm}
      style={({ pressed }) => [
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: t.radius.sm,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: t.colors.lineStrong,
          backgroundColor: pressed ? t.colors.primaryTint : t.colors.surface,
          gap: 4,
          padding: 6,
        },
      ]}
    >
      <Icon name={icon} size={24} color={t.colors.primary} />
      <Text variant="micro" tone="brand" align="center" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 2, right: 2 },
});
