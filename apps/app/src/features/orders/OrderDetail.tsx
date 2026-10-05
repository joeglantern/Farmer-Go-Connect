import type { OrderDetailDto, OrderStatus } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../../data/cart';
import { statusView, trackingStep, useOrder, useOrderAction } from '../../data/orders';
import { joinChannel } from '../../data/realtime';
import { useSession } from '../../data/session';
import i18n from '../../i18n';
import { api } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { dateLong, dateShort, kes, produceName, qty, timeAgo, timeShort, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Divider, Pill } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

type Order = OrderDetailDto;

interface ReorderResult {
  cart: {
    groups: {
      farmId: string;
      farmName: string;
      farmerFirstName: string;
      county: string;
      items: {
        listingId: string;
        produceId: string;
        name: string;
        nameSw: string;
        unit: string;
        pricePerUnit: number;
        available: number;
        photoUrl: string | null;
      }[];
    }[];
  };
  added: { listingId: string; name: string; quantity: number; reduced: boolean }[];
  skipped: { listingId: string; name: string; reason: string }[];
}

export function OrderDetail({ id, embedded }: { id: string; embedded?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const order = useOrder(id);

  useEffect(() => joinChannel(`order:${id}`), [id]);

  if (order.isLoading) {
    return (
      <View style={{ flex: 1, padding: 20, gap: 14 }}>
        {!embedded && <Header />}
        <Skeleton width="50%" height={28} />
        <Skeleton height={60} />
        <Skeleton height={140} radius={14} />
        <Skeleton height={140} radius={14} />
      </View>
    );
  }
  if (order.error || !order.data) {
    return (
      <View style={{ flex: 1 }}>
        {!embedded && <Header />}
        <ErrorState
          onRetry={() => order.refetch()}
          message={order.error ? humanError(order.error) : undefined}
        />
      </View>
    );
  }

  const o = order.data;
  const wide = size === 'expanded' && !embedded;
  const main = (
    <>
      <StatusHero o={o} />
      <Actions o={o} />
      <Items o={o} />
      <Delivery o={o} />
      <Quality o={o} />
    </>
  );
  const side = (
    <>
      <Money o={o} />
      <Timeline o={o} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {!embedded && (
        <Header title={o.code} subtitle={o.viewer === 'buyer' ? o.farmer.name : o.buyerOrg.name} />
      )}
      <ScrollView
        contentContainerStyle={{
          padding: embedded ? 24 : 20,
          paddingTop: embedded ? 20 : 4,
          paddingBottom: insets.bottom + 40,
          gap: 16,
          maxWidth: wide ? t.layout.contentMax : 760,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {embedded && (
          <View style={{ gap: 2 }}>
            <Text variant="title2" numeric>
              {o.code}
            </Text>
            <Text variant="callout" tone="secondary">
              {o.viewer === 'buyer' ? o.farmer.name : o.buyerOrg.name}
            </Text>
          </View>
        )}
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
            <View style={{ flex: 1.5, gap: 16 }}>{main}</View>
            <View style={{ flex: 1, gap: 16 }}>{side}</View>
          </View>
        ) : (
          <>
            {main}
            {side}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Status hero and progress ─────────────────────────────────

const STEPS = [
  'orders.step.placed',
  'orders.step.processing',
  'orders.step.outForDelivery',
  'orders.step.delivered',
];

function StatusHero({ o }: { o: Order }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const s = statusView(o.status, o.viewer);
  const ended = ['CANCELLED', 'QA_REJECTED', 'REFUNDED'].includes(o.status);
  const step = trackingStep(o.status);
  const hintKey = `orders.hint.${o.viewer === 'farmer' || o.viewer === 'agent' ? 'farmer' : 'buyer'}.${o.status}`;
  return (
    <Card style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Pill label={tr(s.labelKey)} tone={s.tone} icon={s.icon} />
        <Text variant="callout" tone="secondary">
          {tr(hintKey, { defaultValue: '', date: dateLong(o.deliveryDate) })}
        </Text>
        {o.status === 'CANCELLED' && o.cancelReason && (
          <Text variant="callout" tone="secondary">
            {tr('orders.cancelReason', { reason: o.cancelReason })}
          </Text>
        )}
      </View>
      {!ended && (
        <View
          style={styles.steps}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 3, now: step }}
        >
          {STEPS.map((k, i) => {
            const done = i < step || (i === step && i === 3);
            const current = i === step && i !== 3;
            return (
              <View key={k} style={styles.stepCol}>
                <View style={styles.stepRow}>
                  <View
                    style={[
                      styles.stepLine,
                      {
                        backgroundColor:
                          i === 0 ? 'transparent' : i <= step ? t.colors.primary : t.colors.line,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.stepDot,
                      {
                        backgroundColor: done || current ? t.colors.primary : t.colors.surface,
                        borderColor: done || current ? t.colors.primary : t.colors.lineStrong,
                      },
                    ]}
                  >
                    {done ? (
                      <Icon name="check" size={14} color="#FFFFFF" weight="bold" />
                    ) : current ? (
                      <Icon name={i === 2 ? 'truck' : 'dot'} size={14} color="#FFFFFF" weight="fill" />
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.stepLine,
                      {
                        backgroundColor:
                          i === 3 ? 'transparent' : i < step ? t.colors.primary : t.colors.line,
                      },
                    ]}
                  />
                </View>
                <Text variant="caption" align="center" tone={i <= step ? 'default' : 'tertiary'}>
                  {tr(k)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

// ─── Actions ──────────────────────────────────────────────────

function Actions({ o }: { o: Order }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const action = useOrderAction(o.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const can = (s: OrderStatus) => o.allowedTransitions.includes(s);
  const buyer = o.viewer === 'buyer' || o.viewer === 'admin';
  const farmer = o.viewer === 'farmer' || o.viewer === 'agent';
  const unpaid =
    o.paymentTerms === 'PREPAID' && (o.paymentStatus === 'UNPAID' || o.paymentStatus === 'PENDING');
  const payable = buyer && unpaid && !['CANCELLED', 'QA_REJECTED', 'REFUNDED', 'PAID'].includes(o.status);
  const delivered = o.status === 'DELIVERED';
  const canDispute = buyer && delivered && !o.receiptConfirmedAt && o.disputes.length === 0;
  const myReview = o.reviews.some((r) => r.authorId === me?.user.id);
  const canReview = (buyer || farmer) && ['DELIVERED', 'PAID'].includes(o.status) && !myReview;
  const trackable = !!o.routeId || o.status === 'IN_TRANSIT';

  // B17: the server rebuilds the lines at today's prices; the app's cart lives on the device,
  // so copy what was added into it and say what could not be.
  const reorder = async () => {
    if (reordering) return;
    setReordering(true);
    try {
      const res = await api.post<ReorderResult>(`/v1/orders/${o.id}/reorder`, {});
      const cart = useCart.getState();
      for (const group of res.cart.groups) {
        for (const line of group.items) {
          const added = res.added.find((a) => a.listingId === line.listingId);
          if (!added) continue;
          const existing = cart.lines.find((x) => x.listingId === line.listingId);
          if (existing) {
            cart.setQuantity(line.listingId, Math.min(line.available, existing.quantity + added.quantity));
          } else {
            cart.restore({
              listingId: line.listingId,
              quantity: added.quantity,
              produce: {
                id: line.produceId,
                name: line.name,
                nameSw: line.nameSw,
                unit: line.unit,
                category: 'OTHER',
                imageUrl: line.photoUrl,
              },
              farm: {
                id: group.farmId,
                name: group.farmName,
                county: group.county,
                farmerName: group.farmerFirstName,
              },
              pricePerUnit: line.pricePerUnit,
              available: line.available,
              photoUrl: line.photoUrl,
              addedAt: Date.now(),
            });
          }
        }
      }
      if (res.added.length === 0) {
        toast.error(tr('orders.reorderNone'));
        return;
      }
      const note = res.skipped.length
        ? ` ${tr('orders.reorderSkipped', { names: res.skipped.map((x) => x.name).join(', ') })}`
        : '';
      toast.show({
        message: `${tr('orders.reorderAdded', { count: res.added.length })}${note}`,
        tone: 'success',
        action: { label: tr('shop.viewCart'), onPress: () => router.push('/cart') },
      });
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setReordering(false);
    }
  };

  const run = async (path: string, success: string, body?: unknown) => {
    try {
      await action.mutateAsync({ path, body });
      toast.success(success);
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const buttons: {
    key: string;
    label: string;
    icon: IconName;
    variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    onPress: () => void;
  }[] = [];

  if (farmer && can('CONFIRMED'))
    buttons.push({
      key: 'confirm',
      label: tr('orders.confirm'),
      icon: 'check',
      variant: 'primary',
      onPress: () => run('confirm', tr('orders.confirmed')),
    });
  if (farmer && can('READY_FOR_QA'))
    buttons.push({
      key: 'ready',
      label: tr('orders.markReady'),
      icon: 'basket',
      variant: 'primary',
      onPress: async () => {
        const ok = await dialog.confirm({
          title: tr('orders.readyTitle'),
          message: tr('orders.readyBody'),
          confirmLabel: tr('orders.markReady'),
          icon: 'basket',
        });
        if (ok) await run('ready', tr('orders.readyDone'));
      },
    });
  if (payable)
    buttons.push({
      key: 'pay',
      label: tr('orders.pay', { amount: kes(o.total) }),
      icon: 'phone',
      variant: 'primary',
      onPress: () => setPayOpen(true),
    });
  if (buyer && delivered && !o.receiptConfirmedAt)
    buttons.push({
      // Same as the action path, so the button shows its spinner while the request runs.
      key: 'confirm-receipt',
      label: tr('orders.confirmReceipt'),
      icon: 'checkCircle',
      variant: 'primary',
      onPress: async () => {
        const ok = await dialog.confirm({
          title: tr('orders.receiptTitle'),
          message: tr('orders.receiptBody'),
          confirmLabel: tr('orders.receiptConfirm'),
          icon: 'checkCircle',
        });
        if (ok) await run('confirm-receipt', tr('orders.receiptDone'));
      },
    });
  if (trackable)
    buttons.push({
      key: 'track',
      label: tr('orders.track'),
      icon: 'truck',
      variant: buttons.length ? 'outline' : 'primary',
      onPress: () => router.push({ pathname: '/track/[id]', params: { id: o.id } }),
    });
  if (canDispute)
    buttons.push({
      key: 'dispute',
      label: tr('orders.report'),
      icon: 'flag',
      variant: 'outline',
      onPress: () => router.push({ pathname: '/report/[id]', params: { id: o.id } }),
    });
  if (canReview)
    buttons.push({
      key: 'review',
      label: tr('orders.rate'),
      icon: 'star',
      variant: 'outline',
      onPress: () => setReviewOpen(true),
    });
  if (buyer && ['DELIVERED', 'PAID', 'CANCELLED', 'REFUNDED', 'QA_REJECTED'].includes(o.status))
    buttons.push({
      key: 'reorder',
      label: tr('orders.orderAgain'),
      icon: 'repeat',
      variant: buttons.length ? 'outline' : 'primary',
      onPress: () => void reorder(),
    });
  if (buyer || farmer)
    buttons.push({
      key: 'chat',
      label: buyer ? tr('orders.messageFarm') : tr('orders.messageBuyer'),
      icon: 'chat',
      variant: 'ghost',
      onPress: () => router.push({ pathname: '/chat/[orderId]', params: { orderId: o.id } }),
    });
  if ((buyer || farmer) && can('CANCELLED'))
    buttons.push({
      key: 'cancel',
      label: tr('orders.cancel'),
      icon: 'close',
      variant: 'ghost',
      onPress: () => setCancelOpen(true),
    });

  if (buttons.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      {o.paymentStatus === 'PENDING' && buyer && <Banner tone="info" message={tr('orders.paymentPending')} />}
      <View style={styles.actions}>
        {buttons.map((b) => (
          <Button
            key={b.key}
            label={b.label}
            icon={b.icon}
            variant={b.variant}
            size="md"
            fullWidth={b.variant === 'primary'}
            loading={
              (action.isPending && action.variables?.path === b.key) || (b.key === 'reorder' && reordering)
            }
            onPress={b.onPress}
            style={b.variant === 'danger' || b.key === 'cancel' ? { opacity: 1 } : undefined}
          />
        ))}
      </View>

      <CancelSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          setCancelOpen(false);
          await run('cancel', tr('orders.cancelled'), { reason });
        }}
      />
      <PaySheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        order={o}
        defaultPhone={me?.user.phoneNumber ?? null}
      />
      <ReviewSheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        orderId={o.id}
        targetName={buyer ? o.farmer.name : o.buyerOrg.name}
      />
    </View>
  );
}

function CancelSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t: tr } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasons = [
    tr('orders.reasons.changed'),
    tr('orders.reasons.late'),
    tr('orders.reasons.price'),
    tr('orders.reasons.other'),
  ];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('orders.cancelTitle')}
      subtitle={tr('orders.cancelBody')}
      footer={
        <Button
          label={tr('orders.cancelConfirm')}
          variant="danger"
          onPress={() => {
            if (reason.trim().length < 3) return setError(tr('orders.reasonRequired'));
            onSubmit(reason.trim());
            setReason('');
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {reasons.map((r) => (
          <Pressable key={r} onPress={() => setReason(r)} accessibilityLabel={r} focusRadius={999}>
            <Pill label={r} tone={reason === r ? 'brand' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <TextField
        label={tr('orders.reason')}
        value={reason}
        onChangeText={(v) => {
          setReason(v);
          setError(null);
        }}
        multiline
        error={error}
      />
    </Sheet>
  );
}

function PaySheet({
  visible,
  onClose,
  order,
  defaultPhone,
}: {
  visible: boolean;
  onClose: () => void;
  order: Order;
  defaultPhone: string | null;
}) {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const action = useOrderAction(order.id);
  const [phone, setPhone] = useState(defaultPhone ? toLocalDigits(defaultPhone) : '');
  const [error, setError] = useState<string | null>(null);
  const due =
    order.total -
    order.payments
      .filter((p) => p.direction === 'IN' && p.status === 'SUCCESS')
      .reduce((s, p) => s + p.amount, 0);
  const pay = async () => {
    const msisdn = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (!msisdn) return setError(tr('auth.errors.phone'));
    try {
      await action.mutateAsync({ path: 'pay', body: { phoneNumber: msisdn } });
      onClose();
      toast.show({ message: tr('orders.checkPhone'), tone: 'success', duration: 7000 });
    } catch (err) {
      setError(humanError(err));
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('orders.payTitle')}
      subtitle={tr('orders.payBody', { amount: kes(due) })}
      footer={
        <Button
          label={tr('orders.pay', { amount: kes(due) })}
          icon="phone"
          onPress={pay}
          loading={action.isPending}
        />
      }
    >
      <PhoneField
        label={tr('checkout.mpesaNumber')}
        value={phone}
        onChangeText={(v) => {
          setPhone(v.replace(/[^\d ]/g, ''));
          setError(null);
        }}
        error={error}
      />
    </Sheet>
  );
}

function ReviewSheet({
  visible,
  onClose,
  orderId,
  targetName,
}: {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  targetName: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const action = useOrderAction(orderId);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const submit = async () => {
    if (!rating) return;
    try {
      await action.mutateAsync({ path: 'review', body: { rating, comment: comment.trim() || undefined } });
      onClose();
      toast.success(tr('orders.thanksReview'));
    } catch (err) {
      toast.error(humanError(err));
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('orders.rateTitle', { name: targetName })}
      footer={
        <Button
          label={tr('orders.submitReview')}
          onPress={submit}
          disabled={!rating}
          loading={action.isPending}
        />
      }
    >
      <View
        style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}
        accessibilityRole="adjustable"
        accessibilityLabel={tr('orders.stars', { count: rating })}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            haptics="selection"
            accessibilityLabel={tr('orders.stars', { count: n })}
            focusRadius={24}
            style={{ padding: 6 }}
          >
            <Icon
              name="star"
              size={36}
              weight={n <= rating ? 'fill' : 'regular'}
              color={n <= rating ? t.colors.star : t.colors.lineStrong}
            />
          </Pressable>
        ))}
      </View>
      <TextField
        label={tr('orders.comment')}
        optional
        value={comment}
        onChangeText={setComment}
        multiline
        placeholder={tr('orders.commentPlaceholder')}
      />
    </Sheet>
  );
}

// ─── Sections ─────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
  right,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={20} color={t.colors.primary} />
        <Text variant="headline" style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </Card>
  );
}

function Items({ o }: { o: Order }) {
  const { t: tr } = useTranslation();
  return (
    <SectionCard title={tr('orders.items')} icon="basket">
      {o.items.map((i, idx) => {
        const accepted = i.inspection ? Number(i.inspection.acceptedQty) : null;
        return (
          <View key={i.id}>
            {idx > 0 && <Divider />}
            <View style={styles.item}>
              <ProduceImage
                uri={i.listing.photoUrls?.[0] ?? i.listing.produce.imageUrl}
                category={i.listing.produce.category}
                produce={i.listing.produce}
                size={52}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{produceName(i.listing.produce)}</Text>
                <Text variant="caption" tone="secondary" numeric>
                  {qty(Number(i.quantity))} {unitLabel(i.listing.produce.unit, Number(i.quantity))} ×{' '}
                  {kes(i.pricePerUnit)}
                </Text>
                {accepted !== null && accepted < Number(i.quantity) && (
                  <Text variant="caption" tone="warning">
                    {tr('orders.acceptedQty', {
                      qty: qty(accepted),
                      unit: unitLabel(i.listing.produce.unit, accepted),
                    })}
                  </Text>
                )}
              </View>
              <Text variant="bodyStrong" numeric>
                {kes(i.lineTotal)}
              </Text>
            </View>
          </View>
        );
      })}
    </SectionCard>
  );
}

function Delivery({ o }: { o: Order }) {
  const { t: tr } = useTranslation();
  const dropoff = o.stops.find((s) => s.kind === 'DROPOFF');
  return (
    <SectionCard title={tr('orders.delivery')} icon="truck">
      <KV label={tr('orders.deliveryDate')} value={dateLong(o.deliveryDate)} />
      {o.deliveryAddress && <KV label={tr('checkout.address')} value={o.deliveryAddress} />}
      {o.route?.driver && <KV label={tr('orders.driver')} value={o.route.driver.name} />}
      {dropoff?.completedAt && (
        <KV
          label={tr('orders.deliveredAt')}
          value={`${dateShort(dropoff.completedAt)}, ${timeShort(dropoff.completedAt)}`}
        />
      )}
      {dropoff?.recipientName && <KV label={tr('orders.receivedBy')} value={dropoff.recipientName} />}
      {dropoff?.podPhotoUrl && <Photo uri={dropoff.podPhotoUrl} label={tr('orders.proof')} />}
      {o.notes && <KV label={tr('checkout.notes')} value={o.notes} />}
    </SectionCard>
  );
}

function Quality({ o }: { o: Order }) {
  const { t: tr } = useTranslation();
  const inspections = o.items.map((i) => i.inspection).filter(Boolean) as NonNullable<
    Order['items'][number]['inspection']
  >[];
  if (inspections.length === 0) return null;
  return (
    <SectionCard title={tr('orders.quality')} icon="shield">
      {inspections.map((insp) => (
        <View key={insp.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pill
              label={insp.passed ? tr('orders.passed') : tr('orders.failed')}
              tone={insp.passed ? 'success' : 'danger'}
              icon={insp.passed ? 'checkCircle' : 'error'}
            />
            <Text variant="callout" tone="secondary">
              {tr('shop.grade', { grade: insp.grade })} · {dateShort(insp.inspectedAt)}
            </Text>
          </View>
          {insp.rejectReason && (
            <Text variant="callout" tone="secondary">
              {insp.rejectReason}
            </Text>
          )}
          {insp.notes && (
            <Text variant="callout" tone="secondary">
              {insp.notes}
            </Text>
          )}
          {insp.photoUrls.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {insp.photoUrls.map((u) => (
                <Photo key={u} uri={u} small />
              ))}
            </ScrollView>
          )}
        </View>
      ))}
    </SectionCard>
  );
}

function Money({ o }: { o: Order }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const farmer = o.viewer === 'farmer' || o.viewer === 'agent';
  const refunds = o.payments
    .filter((p) => p.direction === 'OUT' && p.status !== 'FAILED')
    .reduce((s, p) => s + p.amount, 0);
  const payStatus = {
    UNPAID: { label: tr('orders.pay_UNPAID'), tone: 'warning' as const },
    PENDING: { label: tr('orders.pay_PENDING'), tone: 'info' as const },
    PAID: { label: tr('orders.pay_PAID'), tone: 'success' as const },
    PARTIALLY_REFUNDED: { label: tr('orders.pay_PARTIALLY_REFUNDED'), tone: 'info' as const },
    REFUNDED: { label: tr('orders.pay_REFUNDED'), tone: 'neutral' as const },
  }[o.paymentStatus];

  if (farmer) {
    const p = o.payout;
    return (
      <SectionCard
        title={tr('orders.yourPayout')}
        icon="wallet"
        right={
          p ? (
            <Pill
              label={tr(`orders.payout_${p.status}`)}
              tone={p.status === 'SUCCESS' ? 'success' : p.status === 'FAILED' ? 'danger' : 'info'}
              size="sm"
            />
          ) : undefined
        }
      >
        <KV label={tr('orders.produceValue')} value={kes(o.acceptedSubtotal ?? o.subtotal)} />
        <KV label={tr('orders.commission')} value={`− ${kes(p?.commission ?? o.commission)}`} />
        <Divider />
        <KV
          label={tr('orders.youReceive')}
          value={kes(p?.amount ?? (o.acceptedSubtotal ?? o.subtotal) - o.commission)}
          strong
        />
        {p?.mpesaReceipt && <KV label={tr('orders.mpesaReceipt')} value={p.mpesaReceipt} />}
        {!p && (
          <Text variant="caption" tone="tertiary">
            {tr('orders.payoutWhen')}
          </Text>
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={tr('orders.payment')}
      icon="receipt"
      right={<Pill label={payStatus.label} tone={payStatus.tone} size="sm" />}
    >
      <KV label={tr('cart.subtotal')} value={kes(o.subtotal)} />
      <KV label={tr('cart.deliveryFee')} value={kes(o.deliveryFee)} />
      {refunds > 0 && <KV label={tr('orders.refunded')} value={`− ${kes(refunds)}`} />}
      <Divider />
      <KV label={tr('cart.total')} value={kes(o.total)} strong />
      <Text variant="caption" tone="tertiary">
        {o.paymentTerms === 'PREPAID'
          ? tr(
              o.paymentStatus === 'UNPAID' || o.paymentStatus === 'PENDING'
                ? 'orders.prepaidDueNote'
                : 'orders.prepaidNote',
            )
          : tr('orders.invoiceNote', { terms: o.paymentTerms.replace('NET_', '') })}
      </Text>
      {o.payments
        .filter((p) => p.status === 'SUCCESS')
        .map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name={p.direction === 'OUT' ? 'refresh' : 'checkCircle'} size={16} color={t.colors.leaf} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {p.direction === 'OUT' ? tr('orders.refundLine') : tr('orders.paidLine')} {p.mpesaReceipt ?? ''}{' '}
              · {dateShort(p.createdAt)}
            </Text>
            <Text variant="caption" numeric>
              {kes(p.amount)}
            </Text>
          </View>
        ))}
    </SectionCard>
  );
}

function Timeline({ o }: { o: Order }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const events = [...o.events].reverse();
  return (
    <SectionCard title={tr('orders.history')} icon="clock">
      {events.map((e, i) => {
        const s = statusView(e.to, o.viewer);
        return (
          <View key={e.id} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={[styles.tlDot, { backgroundColor: i === 0 ? t.colors.primary : t.colors.lineStrong }]}
              />
              {i < events.length - 1 && <View style={[styles.tlLine, { backgroundColor: t.colors.line }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 14, gap: 2 }}>
              <Text variant="calloutStrong">{tr(s.labelKey)}</Text>
              {e.note && (
                <Text variant="caption" tone="secondary">
                  {noteText(e.note)}
                </Text>
              )}
              <Text variant="caption" tone="tertiary">
                {timeAgo(e.createdAt)}
              </Text>
            </View>
          </View>
        );
      })}
    </SectionCard>
  );
}

/** Event notes can be a bare dispute reason code; show those in the reader's language. */
function noteText(note: string) {
  return /^(QUALITY|QUANTITY|LATE|DAMAGED|OTHER)$/.test(note) ? i18n.t(`report.reasons.${note}`) : note;
}

function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text variant={strong ? 'headline' : 'callout'} tone={strong ? 'default' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'headline' : 'callout'} numeric style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function Photo({ uri, label, small }: { uri: string; label?: string; small?: boolean }) {
  const t = useTheme();
  const s = small ? 88 : undefined;
  return (
    <View style={{ gap: 4 }}>
      {label && (
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
      )}
      <Image
        source={{ uri }}
        style={{
          width: s ?? '100%',
          height: s ?? 180,
          borderRadius: t.radius.sm,
          backgroundColor: t.colors.surfaceMuted,
        }}
        contentFit="cover"
        transition={200}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row' },
  stepCol: { flex: 1, alignItems: 'center', gap: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 3, borderRadius: 2 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  tlLine: { width: 2, flex: 1, marginTop: 2 },
});
