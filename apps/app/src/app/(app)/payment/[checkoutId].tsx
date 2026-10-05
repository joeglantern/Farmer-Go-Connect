import { normalizeKenyanPhone } from '@farmgo/contracts';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { getCheckout, rememberedMpesaPhone, rememberMpesaPhone } from '../../../data/checkout';
import { onRealtime } from '../../../data/realtime';
import { useSession } from '../../../data/session';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { kes } from '../../../lib/format';
import { useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Divider } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { useToast } from '../../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../../ui/PhoneAndCode';
import { Screen } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

/** After Place Order: waits for M-Pesa or card, then confirms. */
export default function PaymentStatus() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const { checkoutId } = useLocalSearchParams<{ checkoutId: string }>();
  const [retrying, setRetrying] = useState(false);
  const accountPhone = useSession((s) => s.me?.user.phoneNumber ?? null);
  const [phone, setPhone] = useState(() => {
    const p = rememberedMpesaPhone() ?? accountPhone;
    return p ? toLocalDigits(p) : '';
  });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['checkout', checkoutId],
    queryFn: () => getCheckout(checkoutId!),
    enabled: !!checkoutId,
    refetchInterval: (query) => (query.state.data?.payment.status === 'PENDING' ? 3000 : false),
  });

  useEffect(
    () =>
      onRealtime((type) => {
        if (type === 'payment.updated') void q.refetch();
      }),
    [q],
  );

  useEffect(() => {
    const url = q.data?.payment.redirectUrl;
    if (q.data?.payment.method === 'CARD' && q.data.payment.status === 'PENDING' && url) {
      void WebBrowser.openAuthSessionAsync(url, 'farmgo://payment-return').then(() => q.refetch());
    }
  }, [q.data?.payment.redirectUrl, q.data?.payment.method, q.data?.payment.status, q]);

  if (q.isLoading) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 80, alignItems: 'center' }}>
          <Skeleton width={120} height={120} radius={60} />
          <Skeleton width="70%" height={28} />
          <Skeleton width="50%" height={16} />
        </View>
      </Screen>
    );
  }
  if (q.error || !q.data)
    return (
      <Screen>
        <ErrorState onRetry={() => q.refetch()} />
      </Screen>
    );

  const c = q.data;
  const status = c.payment.status;
  const ordersCard = (
    <Card style={{ gap: 10, width: '100%' }}>
      {c.orders.map((o, i) => (
        <View key={o.id}>
          {i > 0 && <Divider />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <Icon name="receipt" size={20} color={t.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="calloutStrong" numeric>
                {o.code}
              </Text>
              <Text variant="caption" tone="secondary">
                {o.farmName}
              </Text>
              {o.refundedAmount > 0 && (
                <Text variant="caption" tone="success">
                  {tr('payment.refunded', { amount: kes(o.refundedAmount) })}
                </Text>
              )}
            </View>
            <Text variant="bodyStrong" numeric>
              {kes(o.total)}
            </Text>
          </View>
        </View>
      ))}
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="headline">{tr('cart.total')}</Text>
        <Text variant="headline" numeric>
          {kes(c.total)}
        </Text>
      </View>
      {c.balanceDue > 0 && c.balanceDue !== c.total && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="callout" tone="secondary">
            {tr('payment.balanceDue')}
          </Text>
          <Text variant="calloutStrong" numeric>
            {kes(c.balanceDue)}
          </Text>
        </View>
      )}
    </Card>
  );

  if (status === 'SUCCESS' || status === 'NOT_REQUIRED') {
    return (
      <Screen
        maxWidth={560}
        footer={
          <>
            <Button
              label={tr('payment.trackOrders')}
              icon="truck"
              onPress={() => router.replace('/orders')}
            />
            <Button
              label={tr('payment.keepShopping')}
              variant="ghost"
              onPress={() => router.replace('/home')}
            />
          </>
        }
      >
        <Animated.View entering={ZoomIn.duration(360).easing(Easing.bezier(0.16, 1, 0.3, 1))}>
          <EmptyState
            art={status === 'SUCCESS' ? 'paymentReceived' : 'orderPlaced'}
            title={status === 'SUCCESS' ? tr('payment.paidTitle') : tr('payment.placedTitle')}
            body={status === 'SUCCESS' ? tr('payment.paidBody') : tr('payment.placedBody')}
          />
        </Animated.View>
        {ordersCard}
      </Screen>
    );
  }

  if (status === 'FAILED') {
    const mpesa = c.payment.method === 'MPESA';
    const retry = async () => {
      const msisdn = mpesa ? normalizeKenyanPhone(`0${toLocalDigits(phone)}`) : null;
      if (mpesa && !msisdn) {
        setPhoneError(tr('auth.errors.phone'));
        return;
      }
      setPhoneError(null);
      setRetrying(true);
      try {
        await api.post(`/v1/checkouts/${c.checkoutId}/pay`, msisdn ? { phoneNumber: msisdn } : {});
        rememberMpesaPhone(msisdn);
        await q.refetch();
      } catch (err) {
        toast.error(humanError(err));
      } finally {
        setRetrying(false);
      }
    };
    return (
      <Screen
        maxWidth={560}
        footer={
          <>
            <Button label={tr('payment.tryAgain')} icon="refresh" onPress={retry} loading={retrying} />
            <Button label={tr('payment.later')} variant="ghost" onPress={() => router.replace('/orders')} />
          </>
        }
      >
        <EmptyState
          art="error"
          title={tr('payment.failedTitle')}
          body={c.payment.message ?? tr('payment.failedBody')}
        />
        {mpesa && (
          <View style={{ width: '100%', marginBottom: 16 }}>
            <PhoneField
              label={tr('checkout.mpesaNumber')}
              hint={tr('payment.retryPhoneHint')}
              placeholder={tr('auth.phonePlaceholder')}
              value={phone}
              onChangeText={(v) => {
                setPhone(v.replace(/[^\d ]/g, ''));
                setPhoneError(null);
              }}
              error={phoneError}
            />
          </View>
        )}
        {ordersCard}
      </Screen>
    );
  }

  return (
    <Screen
      maxWidth={560}
      footer={
        <Button
          label={tr('payment.viewOrders')}
          variant="outline"
          onPress={() => router.replace('/orders')}
        />
      }
    >
      <View style={{ alignItems: 'center', gap: 16, paddingTop: 48 }}>
        <PhonePulse />
        <Text variant="title1" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">
          {c.payment.method === 'CARD' ? tr('payment.cardWaiting') : tr('payment.checkPhone')}
        </Text>
        <Text variant="body" tone="secondary" align="center" style={{ maxWidth: 360 }}>
          {c.payment.method === 'CARD'
            ? tr('payment.cardBody')
            : tr('payment.checkPhoneBody', { amount: kes(c.total) })}
        </Text>
      </View>
      <View style={{ marginTop: 28 }}>{ordersCard}</View>
    </Screen>
  );
}

/** Gentle pulse around a phone while the M-Pesa prompt is open (still when Reduce Motion). */
function PhonePulse() {
  const t = useTheme();
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (!reduce)
      s.value = withRepeat(withTiming(1.18, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, true);
  }, [s, reduce]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2 - s.value * 1.2 }));
  return (
    <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 132,
            height: 132,
            borderRadius: 66,
            backgroundColor: t.colors.primaryTint,
          },
          ring,
        ]}
      />
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: t.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="phone" size={40} color="#FFFFFF" weight="fill" />
      </View>
    </View>
  );
}
