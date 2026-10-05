import { normalizeKenyanPhone } from '@farmgo/contracts';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../../data/session';
import { useInput, useOrderInput } from '../../../features/farmer/data';
import { humanError } from '../../../lib/errors';
import { kes, qty, unitLabel } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Divider, Pill, Stepper } from '../../../ui/Controls';
import { Icon } from '../../../ui/Icon';
import { ProduceImage } from '../../../ui/Media';
import { Banner } from '../../../ui/overlays/Banner';
import { Sheet } from '../../../ui/overlays/Sheet';
import { useToast } from '../../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../../ui/PhoneAndCode';
import { Header } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

/** One green-input product and the order sheet (paid by M-Pesa, held until delivery). */
export default function InputProduct() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useInput(id);
  const order = useOrderInput(id);
  const idem = useRef(Crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState(me?.user.phoneNumber ? toLocalDigits(me.user.phoneNumber) : '');
  const [error, setError] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <Header />
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton height={240} radius={16} />
          <Skeleton height={100} radius={14} />
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
  const p = q.data;
  const stock = Number(p.stock);
  const ownProduct = me?.organizations.some((o) => o.id === p.supplierOrgId);
  const wide = size !== 'compact';

  const submit = async () => {
    const msisdn = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (!msisdn) return setError(tr('auth.errors.phone'));
    try {
      const res = await order.mutateAsync({
        quantity: amount,
        deliveryNote: note.trim() || undefined,
        phoneNumber: msisdn,
        idempotencyKey: idem.current,
      });
      idem.current = Crypto.randomUUID();
      setOpen(false);
      if (res.payment.status === 'FAILED') toast.error(res.payment.message);
      else toast.show({ message: tr('inputs.ordered'), tone: 'success', duration: 7000 });
      // Back to the inputs screen on My orders, where the new order and its Pay button are.
      router.dismissTo({ pathname: '/inputs', params: { tab: 'orders' } });
    } catch (err) {
      setError(humanError(err));
    }
  };

  const photo = p.photoUrls[0];
  const hero = (
    <View
      style={{
        height: wide ? 320 : 240,
        borderRadius: t.radius.lg,
        overflow: 'hidden',
        backgroundColor: t.colors.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          accessibilityLabel={p.name}
        />
      ) : (
        <ProduceImage category="INPUT" size={120} radius={60} />
      )}
    </View>
  );
  const details = (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text variant="title1">{p.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="storefront" size={16} color={t.colors.textTertiary} />
          <Text variant="callout" tone="secondary">
            {p.supplierOrg.name} · {p.county}
          </Text>
        </View>
      </View>
      <Text variant="priceLarge" tone="brand" numeric>
        {kes(p.pricePerUnit)}
        <Text variant="callout" tone="secondary">
          {' '}
          {tr('common.perUnit', { unit: unitLabel(p.unit) })}
        </Text>
      </Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill label={tr(`inputs.cat.${p.category}`)} size="sm" />
        {p.isOrganic && <Pill label={tr('farms.organic')} tone="success" icon="leaf" size="sm" />}
        <Pill
          label={
            stock > 0
              ? tr('inputs.inStock', { qty: qty(stock), unit: unitLabel(p.unit, stock) })
              : tr('inputs.outOfStock')
          }
          tone={stock > 0 ? 'brand' : 'warning'}
          size="sm"
        />
      </View>
      {p.description && (
        <Text variant="body" tone="secondary">
          {p.description}
        </Text>
      )}
      <Card style={{ gap: 10 }}>
        {[
          { icon: 'shield' as const, text: tr('inputs.trust.held') },
          { icon: 'truck' as const, text: tr('inputs.trust.delivery') },
          { icon: 'users' as const, text: tr('inputs.trust.youth') },
        ].map((r) => (
          <View key={r.text} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name={r.icon} size={20} color={t.colors.primary} />
            <Text variant="callout" style={{ flex: 1 }}>
              {r.text}
            </Text>
          </View>
        ))}
      </Card>
      {ownProduct ? (
        <Banner tone="info" message={tr('inputs.ownProduct')} />
      ) : (
        <Button
          label={stock > 0 ? tr('inputs.order') : tr('inputs.outOfStock')}
          icon="bag"
          disabled={stock <= 0}
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header title={wide ? p.name : undefined} />
      <ScrollView
        contentContainerStyle={{
          padding: wide ? 32 : 20,
          paddingTop: 4,
          paddingBottom: insets.bottom + 40,
          gap: 20,
          maxWidth: t.layout.contentMax,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 28 }}>
            <View style={{ flex: 1 }}>{hero}</View>
            <View style={{ flex: 1 }}>{details}</View>
          </View>
        ) : (
          <>
            {hero}
            {details}
          </>
        )}
      </ScrollView>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={tr('inputs.orderTitle', { name: p.name })}
        footer={
          <Button
            label={tr('inputs.orderPay', { amount: kes(Math.round(p.pricePerUnit * amount)) })}
            icon="phone"
            onPress={submit}
            loading={order.isPending}
          />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="calloutStrong">{tr('inputs.howMany', { unit: unitLabel(p.unit, 2) })}</Text>
          <Stepper
            value={amount}
            onChange={setAmount}
            min={1}
            max={Math.max(1, Math.floor(stock))}
            unit={unitLabel(p.unit, amount)}
            label={tr('inputs.howMany', { unit: unitLabel(p.unit, 2) })}
          />
        </View>
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="headline">{tr('cart.total')}</Text>
          <Text variant="headline" numeric>
            {kes(Math.round(p.pricePerUnit * amount))}
          </Text>
        </View>
        <PhoneField
          label={tr('checkout.mpesaNumber')}
          value={phone}
          onChangeText={(v) => {
            setPhone(v.replace(/[^\d ]/g, ''));
            setError(null);
          }}
          error={error}
        />
        <TextField
          label={tr('inputs.deliveryNote')}
          optional
          value={note}
          onChangeText={setNote}
          maxLength={300}
          placeholder={tr('inputs.deliveryNotePlaceholder')}
        />
        <Text variant="caption" tone="tertiary">
          {tr('inputs.heldNote')}
        </Text>
      </Sheet>
    </View>
  );
}
