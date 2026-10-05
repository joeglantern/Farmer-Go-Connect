import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { type CartLine, cartTotals, useCart } from '../../data/cart';
import { useDeliveryFee } from '../../data/checkout';
import { kes, produceName, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Card, Divider, Stepper } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { EmptyState } from '../../ui/States';
import { Text } from '../../ui/Text';

/** Mockup screen 6: Your Cart. */
export default function Cart() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const lines = useCart((s) => s.lines);
  const { setQuantity, remove, restore, clear } = useCart.getState();
  const { subtotal, byFarm } = cartTotals(lines);
  const deliveryFee = useDeliveryFee();
  const total = subtotal + deliveryFee;
  const wide = size !== 'compact';

  const removeLine = (line: CartLine) => {
    const removed = remove(line.listingId);
    if (removed) {
      toast.show({
        message: tr('cart.removed', { name: produceName(removed.produce) }),
        action: { label: tr('cart.undo'), onPress: () => restore(removed) },
      });
    }
  };

  const clearAll = async () => {
    const ok = await dialog.confirm({
      title: tr('cart.clearTitle'),
      message: tr('cart.clearBody', { count: lines.length }),
      confirmLabel: tr('cart.clearConfirm'),
      cancelLabel: tr('cart.keep'),
      destructive: true,
      icon: 'trash',
    });
    if (ok) {
      const snapshot = [...lines];
      clear();
      toast.show({
        message: tr('cart.cleared'),
        action: { label: tr('cart.undo'), onPress: () => snapshot.forEach(restore) },
      });
    }
  };

  if (lines.length === 0) {
    return (
      <Screen header={<Header title={tr('cart.title')} />}>
        <View style={{ paddingTop: 48 }}>
          <EmptyState
            art="emptyCart"
            title={tr('cart.emptyTitle')}
            body={tr('cart.emptyBody')}
            action={{ label: tr('cart.browse'), icon: 'basket', onPress: () => router.replace('/home') }}
          />
        </View>
      </Screen>
    );
  }

  const summary = (
    <Card style={{ gap: 12 }} elevated={wide}>
      {wide && (
        <Text variant="title3" accessibilityRole="header">
          {tr('cart.summary')}
        </Text>
      )}
      <Row label={tr('cart.subtotal')} value={kes(subtotal)} />
      <Row
        label={tr('cart.deliveryFee')}
        value={kes(deliveryFee)}
        hint={byFarm.length > 1 ? tr('cart.oneDelivery', { farms: byFarm.length }) : undefined}
      />
      <Divider />
      <Row label={tr('cart.total')} value={kes(total)} strong />
      {wide && (
        <Button label={tr('cart.checkout')} onPress={() => router.push('/checkout')} iconRight="forward" />
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="shield" size={16} color={t.colors.leaf} />
        <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
          {tr('cart.protection')}
        </Text>
      </View>
    </Card>
  );

  const list = (
    <View style={{ gap: 20 }}>
      {byFarm.map((group) => (
        <View key={group.farmId} style={{ gap: 10 }}>
          <View style={styles.farmHead}>
            <Icon name="farm" size={18} color={t.colors.primary} />
            <Text variant="calloutStrong" style={{ flex: 1 }}>
              {group.farm.name}
            </Text>
            <Text variant="caption" tone="tertiary">
              {group.farm.county}
            </Text>
          </View>
          {group.items.map((line, i) => (
            <View key={line.listingId}>
              {i > 0 && <Divider inset={80} />}
              <View style={styles.line}>
                <Pressable
                  onPress={() => router.push({ pathname: '/product/[id]', params: { id: line.listingId } })}
                  accessibilityLabel={produceName(line.produce)}
                  focusRadius={t.radius.sm}
                >
                  <ProduceImage
                    uri={line.photoUrl}
                    category={line.produce.category}
                    produce={line.produce}
                    size={68}
                  />
                </Pressable>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {produceName(line.produce)} (
                        {unitLabel(line.produce.unit) === 'kg' ? '1 kg' : unitLabel(line.produce.unit)})
                      </Text>
                      <Text variant="callout" tone="secondary" numeric>
                        {kes(line.pricePerUnit)}
                      </Text>
                    </View>
                    <IconButton
                      icon="trash"
                      label={tr('cart.removeItem', { name: produceName(line.produce) })}
                      onPress={() => removeLine(line)}
                      size={36}
                      iconSize={19}
                      color={t.colors.textTertiary}
                    />
                  </View>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Stepper
                      value={line.quantity}
                      onChange={(v) => (v <= 0 ? removeLine(line) : setQuantity(line.listingId, v))}
                      min={0}
                      max={line.available}
                      size="sm"
                      label={tr('shop.quantityOf', { name: produceName(line.produce) })}
                    />
                    <Text variant="bodyStrong" numeric>
                      {kes(Math.round(line.quantity * line.pricePerUnit))}
                    </Text>
                  </View>
                  {line.quantity >= line.available && (
                    <Text variant="caption" tone="warning">
                      {tr('cart.maxReached', {
                        qty: line.available,
                        unit: unitLabel(line.produce.unit, line.available),
                      })}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <Screen
      header={
        <Header
          title={tr('cart.title')}
          right={
            <Pressable
              onPress={clearAll}
              accessibilityLabel={tr('cart.clearAll')}
              style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              focusRadius={8}
            >
              <Text variant="calloutStrong" tone="brand">
                {tr('cart.clearAll')}
              </Text>
            </Pressable>
          }
        />
      }
      footer={
        wide ? undefined : <Button label={tr('cart.checkout')} onPress={() => router.push('/checkout')} />
      }
    >
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 32, alignItems: 'flex-start', paddingTop: 8 }}>
          <View style={{ flex: 1.5 }}>
            <Card>{list}</Card>
          </View>
          <View style={{ flex: 1, maxWidth: 400, gap: 12 }}>{summary}</View>
        </View>
      ) : (
        <View style={{ gap: 24, paddingTop: 4 }}>
          {list}
          {summary}
        </View>
      )}
    </Screen>
  );
}

function Row({
  label,
  value,
  strong,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant={strong ? 'title3' : 'callout'} tone={strong ? 'default' : 'secondary'}>
          {label}
        </Text>
        <Text variant={strong ? 'title3' : 'bodyStrong'} numeric>
          {value}
        </Text>
      </View>
      {hint && (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  farmHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
});
