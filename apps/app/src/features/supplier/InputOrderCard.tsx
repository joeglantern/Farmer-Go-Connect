import type { InputOrderListItemDto } from '@farmgo/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { kes, qty, timeAgo, unitLabel } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Avatar, Card, Pill } from '../../ui/Controls';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Text } from '../../ui/Text';
import { prettyPhone } from '../agent/data';
import { callPhone } from '../qa/data';
import { type InputOrderStatus, nextMoves, orderStatusView, useTransition } from './data';

const DESTRUCTIVE: InputOrderStatus[] = ['REJECTED', 'CANCELLED'];
const ICON = {
  ACCEPTED: 'check',
  REJECTED: 'close',
  DISPATCHED: 'truck',
  DELIVERED: 'checkCircle',
  CANCELLED: 'close',
  PENDING: 'clock',
} as const;

/** Confirm, then move an input order to its next status. */
export function useMoveOrder() {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const move = useTransition();
  const run = async (o: InputOrderListItemDto, to: InputOrderStatus) => {
    const destructive = DESTRUCTIVE.includes(to);
    const ok = await dialog.confirm({
      title: tr(`supplier.confirm.${to}.title`),
      message: tr(`supplier.confirm.${to}.body`, {
        buyer: o.buyer.name,
        qty: `${qty(o.quantity)} ${unitLabel(o.product.unit, o.quantity)}`,
        product: o.product.name,
      }),
      confirmLabel: tr(`supplier.move.${to}`),
      destructive,
      icon: destructive ? 'warning' : ICON[to],
    });
    if (!ok) return;
    move.mutate(
      { id: o.id, to },
      {
        onSuccess: () => toast.success(tr(`supplier.moved.${to}`)),
        onError: (e) => toast.error(humanError(e)),
      },
    );
  };
  return {
    run,
    pendingId: move.isPending ? move.variables?.id : undefined,
    pendingTo: move.isPending ? move.variables?.to : undefined,
  };
}

export function OrderActions({ order, compact }: { order: InputOrderListItemDto; compact?: boolean }) {
  const { t: tr } = useTranslation();
  const { run, pendingId, pendingTo } = useMoveOrder();
  const moves = nextMoves(order.status);
  if (!moves.length) return null;
  const busy = pendingId === order.id;
  // The farmer's money is held until delivery, so nothing goes out before it is paid.
  const unpaid = order.paymentStatus !== 'PAID';
  return (
    <View style={[styles.actions, compact && { flexWrap: 'nowrap' }]}>
      {moves.map((to, i) => (
        <Button
          key={to}
          label={tr(`supplier.move.${to}`)}
          icon={ICON[to]}
          size={compact ? 'sm' : 'md'}
          variant={i === 0 ? 'primary' : DESTRUCTIVE.includes(to) ? 'outline' : 'secondary'}
          loading={busy && pendingTo === to}
          disabled={(busy && pendingTo !== to) || (to === 'DISPATCHED' && unpaid)}
          style={compact ? undefined : { flex: i === 0 ? 1.4 : 1 }}
          fullWidth={!compact}
          onPress={() => void run(order, to)}
        />
      ))}
    </View>
  );
}

export function InputOrderCard({ order }: { order: InputOrderListItemDto }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const s = orderStatusView(order.status);
  const open = ['PENDING', 'ACCEPTED', 'DISPATCHED'].includes(order.status);
  return (
    <Card style={{ gap: 14 }}>
      <View style={styles.head}>
        <Avatar name={order.buyer.name} size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {order.buyer.name}
          </Text>
          <Text variant="caption" tone="secondary" numeric>
            {[prettyPhone(order.buyer.phoneNumber), timeAgo(order.createdAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon="phone"
          label={tr('supplier.callBuyer', { name: order.buyer.name })}
          variant="tinted"
          disabled={!order.buyer.phoneNumber}
          onPress={() => callPhone(order.buyer.phoneNumber)}
        />
      </View>
      <View style={[styles.line, { backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.sm }]}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {order.product.name}
          </Text>
          <Text variant="caption" tone="secondary" numeric>
            {qty(order.quantity)} {unitLabel(order.product.unit, order.quantity)} × {kes(order.pricePerUnit)}
          </Text>
        </View>
        <Text variant="priceLarge" numeric>
          {kes(order.total)}
        </Text>
      </View>
      {order.deliveryNote && (
        <Text variant="callout" tone="secondary">
          "{order.deliveryNote}"
        </Text>
      )}
      <View style={styles.head}>
        <Pill label={tr(`supplier.status.${order.status}`)} tone={s.tone} icon={s.icon} size="sm" />
        {open && (
          <Pill
            label={tr(`orders.pay_${order.paymentStatus}`)}
            tone={order.paymentStatus === 'PAID' ? 'success' : 'warning'}
            size="sm"
          />
        )}
      </View>
      {order.status === 'ACCEPTED' && order.paymentStatus !== 'PAID' && (
        <Text variant="caption" tone="secondary">
          {tr('supplier.waitingForPayment')}
        </Text>
      )}
      <OrderActions order={order} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
