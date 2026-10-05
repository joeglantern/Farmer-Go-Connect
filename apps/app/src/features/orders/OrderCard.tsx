import type { OrderListItemDto } from '@farmgo/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { statusView } from '../../data/orders';
import { dateShort, kes, produceName } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Pill } from '../../ui/Controls';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';

/** Order row: produce, code, counterparty, delivery date, status, total. */
export function OrderCard({
  order,
  perspective,
  selected,
  onPress,
}: {
  order: OrderListItemDto;
  perspective: 'buyer' | 'farmer' | 'staff';
  selected?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const first = order.items[0];
  const extra = order.items.length - 1;
  const s = statusView(order.status, perspective === 'farmer' ? 'farmer' : 'buyer');
  const party = perspective === 'farmer' ? order.buyerOrg.name : first?.listing ? order.farmer.name : '';
  const title = first
    ? `${produceName(first.listing.produce)}${extra > 0 ? ` ${tr('orders.andMore', { count: extra })}` : ''}`
    : order.code;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${order.code}, ${title}, ${tr(s.labelKey)}, ${kes(order.total)}`}
      accessibilityState={{ selected: !!selected }}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.card,
        {
          borderRadius: t.radius.md,
          backgroundColor: selected
            ? t.colors.primaryTint
            : pressed || hovered
              ? t.colors.surfaceMuted
              : t.colors.surface,
          borderColor: selected ? t.colors.primary : t.colors.line,
        },
      ]}
    >
      <ProduceImage
        uri={first?.listing.photoUrls?.[0] ?? first?.listing.produce.imageUrl}
        category={first?.listing.produce.category}
        produce={first?.listing.produce}
        size={60}
      />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.top}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Text>
          <Text variant="bodyStrong" numeric>
            {kes(order.total)}
          </Text>
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {order.code} · {party} · {tr('orders.deliveryOn', { date: dateShort(order.deliveryDate) })}
        </Text>
        <Pill label={tr(s.labelKey)} tone={s.tone} icon={s.icon} size="sm" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1, alignItems: 'center' },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
});
