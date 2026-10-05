import { Image } from 'expo-image';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { produceArt } from '../assets/registry';
import { useTheme } from '../theme/theme';
import { palette } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

/** Soft produce-colored grounds so fallback tiles are varied but calm. */
const TINTS: Record<string, [string, string]> = {
  VEGETABLE: ['#E3F0DD', palette.green[600]],
  HERB: ['#E6F2E0', palette.green[500]],
  FRUIT: ['#FBEBDD', palette.carrot],
  TUBER: ['#F3EADF', '#9A6A3A'],
  GRAIN: ['#F7EFD6', '#A07A12'],
  LEGUME: ['#F1EBDD', '#8B6A3E'],
  DAIRY: ['#E8F0F4', palette.sky],
  POULTRY: ['#F7EDE2', '#A8622E'],
  MEAT: ['#F7E4E0', palette.tomato],
  VALUE_ADDED: ['#F5EEDB', '#B07A18'],
  OTHER: ['#EEF2EC', palette.green[600]],
};

const ICONS: Record<string, IconName> = {
  VEGETABLE: 'leaf',
  HERB: 'plant',
  FRUIT: 'basket',
  TUBER: 'seedling',
  GRAIN: 'scale',
  LEGUME: 'scale',
  DAIRY: 'drop',
  POULTRY: 'storefront',
  MEAT: 'storefront',
  VALUE_ADDED: 'sparkle',
  OTHER: 'basket',
};

/**
 * Produce or listing photo with rounded corners. Without an uploaded photo it shows the
 * bundled catalog photo for that produce (`produce` slug or name); failing that, a flat tile
 * in the produce's own color family with its glyph (never a gray box).
 */
export function ProduceImage({
  uri,
  category = 'OTHER',
  size,
  style,
  radius,
  accessibilityLabel,
  produce,
}: {
  uri?: string | null;
  /** Identifies the catalog photo used when there is no uploaded one. */
  produce?: { slug?: string | null; name?: string | null } | null;
  category?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const [bg, fg] = TINTS[category] ?? TINTS.OTHER!;
  const r = radius ?? t.radius.sm;
  const dims = size ? { width: size, height: size } : null;
  const source = uri ? { uri } : produceArt(produce);
  // Catalog photos are small studio shots: in a large frame, show them whole on their own
  // linen ground instead of stretching them.
  const studio = !uri && !!source && !size;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.box,
        dims,
        {
          borderRadius: r,
          backgroundColor: studio ? '#ECEAE6' : t.scheme === 'dark' ? t.colors.surfaceMuted : bg,
        },
        style,
      ]}
    >
      {source ? (
        <Image
          source={source}
          style={studio ? styles.studio : StyleSheet.absoluteFill}
          contentFit={studio ? 'contain' : 'cover'}
          transition={200}
          recyclingKey={uri ?? produce?.slug ?? produce?.name ?? undefined}
        />
      ) : (
        <Icon
          name={ICONS[category] ?? 'basket'}
          size={Math.max(20, (size ?? 96) * 0.36)}
          color={fg}
          weight="duotone"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  studio: { width: '82%', height: '82%', maxWidth: 360, maxHeight: 360 },
});
