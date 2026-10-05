import type { County } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import * as Crypto from 'expo-crypto';
import { Redirect, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { addressLine, useAddresses } from '../../data/addresses';
import { cartTotals, useCart } from '../../data/cart';
import {
  type CheckoutBody,
  DEFAULT_DELIVERY_FEE,
  type PayMethod,
  placeCheckout,
  rememberMpesaPhone,
  toItems,
  useQuote,
  useSlots,
} from '../../data/checkout';
import { useSession } from '../../data/session';
import { ApiError } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { dateLong, kes, relativeDay } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Chip, Divider, RadioRow } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { Sheet } from '../../ui/overlays/Sheet';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { CountyPicker, LocationButton, SelectField } from '../../ui/Pickers';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

/** Mockup screen 7: Checkout. */
export default function Checkout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const me = useSession((s) => s.me);
  const lines = useCart((s) => s.lines);
  const clearCart = useCart((s) => s.clear);
  const org = me?.organizations[0];
  const terms = org?.profile?.paymentTerms ?? 'PREPAID';

  const saved = useAddresses();
  const savedList = saved.data ?? [];
  // A saved address (B08) is used when the buyer has one; 'new' means type a different one.
  const [choice, setChoice] = useState<string | null>(null);
  const [addrOpen, setAddrOpen] = useState(false);
  const chosenSaved =
    choice === 'new' ? null : (savedList.find((a) => a.id === choice) ?? savedList[0] ?? null);
  const [county, setCounty] = useState<string | null>(org?.profile?.county ?? me?.user.county ?? null);
  const [address, setAddress] = useState(org?.profile?.address ?? '');
  const [town, setTown] = useState(org?.profile?.town ?? '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    org?.profile?.lat != null && org?.profile?.lng != null
      ? { lat: org.profile.lat, lng: org.profile.lng }
      : null,
  );
  const [countyOpen, setCountyOpen] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const slots = useSlots(chosenSaved?.county ?? county ?? undefined);
  const [date, setDate] = useState<string | null>(null);
  const [window, setWindow] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>(terms === 'PREPAID' ? 'MPESA' : 'INVOICE');
  const [phone, setPhone] = useState(me?.user.phoneNumber ? toLocalDigits(me.user.phoneNumber) : '');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(Crypto.randomUUID());

  const chosenDate = date ?? slots.data?.[0]?.date ?? null;
  const chosenWindow = window ?? slots.data?.[0]?.windows.find((w) => w.available)?.value ?? null;

  const body = useMemo<CheckoutBody | null>(() => {
    if (!chosenDate || !chosenWindow) return null;
    if (chosenSaved) {
      return {
        items: toItems(lines),
        addressId: chosenSaved.id,
        deliveryDate: chosenDate,
        deliveryWindow: chosenWindow,
      };
    }
    if (!county) return null;
    return {
      items: toItems(lines),
      address: {
        line1: address.trim() || town.trim() || county,
        county: county as County,
        town: town.trim() || undefined,
        ...(point ?? {}),
      },
      deliveryDate: chosenDate,
      deliveryWindow: chosenWindow,
    };
  }, [lines, address, town, county, point, chosenDate, chosenWindow, chosenSaved]);
  const quote = useQuote(body);

  if (lines.length === 0 && !busy) return <Redirect href="/cart" />;

  const local = cartTotals(lines);
  const subtotal = quote.data?.subtotal ?? local.subtotal;
  const deliveryFee = quote.data?.deliveryFee ?? DEFAULT_DELIVERY_FEE;
  const total = quote.data?.total ?? subtotal + deliveryFee;
  const problems = quote.data?.problems ?? [];
  // Methods come from the quote; until it arrives, only what every buyer can use.
  const methods: PayMethod[] =
    quote.data?.paymentMethods ?? (terms === 'PREPAID' ? ['MPESA'] : ['INVOICE', 'MPESA']);

  // Why the order cannot be placed right now, said out loud instead of a silent no-op.
  const BLOCKING = ['LISTING_UNAVAILABLE', 'NOT_ON_DATE', 'OWN_LISTING'];
  const noSlots = !slots.isLoading && !slots.error && (!chosenDate || !chosenWindow);
  const blockReason = slots.error
    ? tr('checkout.slotsFailed')
    : noSlots
      ? tr('checkout.noSlots')
      : problems.some((p) => BLOCKING.includes(p.code))
        ? tr('checkout.fixProblems')
        : quote.error
          ? tr('checkout.quoteFailed')
          : null;
  const waiting = slots.isLoading || (!!body && quote.isLoading);

  const place = async () => {
    const e: Record<string, string> = {};
    if (!chosenSaved) {
      if (!county) e.county = tr('setup.countyPlaceholder');
      if (address.trim().length < 4) e.address = tr('setup.addressRequired');
    }
    const msisdn = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (method === 'MPESA' && !msisdn) e.phone = tr('auth.errors.phone');
    setErrors(e);
    if (Object.keys(e).length) return;
    if (!body || blockReason) {
      setFormError(blockReason ?? tr('checkout.pickTime'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await placeCheckout(
        {
          ...body,
          paymentMethod: method,
          phoneNumber: method === 'MPESA' ? msisdn! : undefined,
          notes: notes.trim() || undefined,
        },
        idem.current,
      );
      rememberMpesaPhone(method === 'MPESA' ? msisdn : null);
      clearCart();
      router.replace({ pathname: '/payment/[checkoutId]', params: { checkoutId: res.checkoutId } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHECKOUT_STOCK_CHANGED') {
        idem.current = Crypto.randomUUID();
        void quote.refetch();
      }
      setFormError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const slotDay = slots.data?.find((s) => s.date === chosenDate);
  const wide = size !== 'compact';

  const delivery = (
    <Card style={{ gap: 16 }}>
      <Text variant="title3" accessibilityRole="header">
        {tr('checkout.delivery')}
      </Text>
      {savedList.length > 0 ? (
        <SelectField
          label={tr('checkout.address')}
          value={
            chosenSaved ? `${chosenSaved.label}: ${addressLine(chosenSaved)}` : tr('checkout.newAddress')
          }
          placeholder={tr('checkout.pickAddress')}
          onPress={() => setAddrOpen(true)}
          icon="location"
        />
      ) : null}
      {!chosenSaved ? (
        <>
          <SelectField
            label={tr('checkout.location')}
            value={county}
            placeholder={tr('setup.countyPlaceholder')}
            onPress={() => setCountyOpen(true)}
            error={errors.county}
            icon="location"
          />
          <TextField
            label={tr('checkout.address')}
            placeholder={tr('checkout.addressPlaceholder')}
            value={address}
            onChangeText={setAddress}
            icon="location"
            error={errors.address}
          />
          <TextField
            label={tr('setup.town')}
            optional
            placeholder="Westlands"
            value={town}
            onChangeText={setTown}
          />
          <LocationButton value={point} onChange={setPoint} />
        </>
      ) : null}
      <SelectField
        label={tr('checkout.time')}
        value={
          chosenDate && chosenWindow
            ? `${relativeDay(chosenDate)}, ${chosenWindow.replace('-', ' to ')}`
            : null
        }
        placeholder={tr('checkout.pickTime')}
        onPress={() => setSlotOpen(true)}
        icon="clock"
      />
      <TextField
        label={tr('checkout.notes')}
        optional
        placeholder={tr('checkout.notesPlaceholder')}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
    </Card>
  );

  const payment = (
    <Card style={{ gap: 12 }}>
      <Text variant="title3" accessibilityRole="header">
        {tr('checkout.payment')}
      </Text>
      {methods.includes('MPESA') && (
        <RadioRow
          label="M-Pesa"
          description={tr('checkout.mpesaHint')}
          selected={method === 'MPESA'}
          onPress={() => setMethod('MPESA')}
          trailing={<Icon name="phone" size={20} color={t.colors.leaf} />}
        />
      )}
      {method === 'MPESA' && (
        <PhoneField
          label={tr('checkout.mpesaNumber')}
          placeholder={tr('auth.phonePlaceholder')}
          value={phone}
          onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))}
          error={errors.phone}
        />
      )}
      {methods.includes('CARD') && (
        <RadioRow
          label={tr('checkout.card')}
          description={tr('checkout.cardHint')}
          selected={method === 'CARD'}
          onPress={() => setMethod('CARD')}
          trailing={<Icon name="card" size={20} color={t.colors.textSecondary} />}
        />
      )}
      {methods.includes('INVOICE') && (
        <RadioRow
          label={tr('checkout.invoice')}
          description={tr('checkout.invoiceHint', { terms: terms.replace('NET_', '') })}
          selected={method === 'INVOICE'}
          onPress={() => setMethod('INVOICE')}
          trailing={<Icon name="invoice" size={20} color={t.colors.textSecondary} />}
        />
      )}
    </Card>
  );

  const summary = (
    <Card style={{ gap: 10 }}>
      <Text variant="title3" accessibilityRole="header">
        {tr('checkout.summary')}
      </Text>
      {local.byFarm.map((g) => (
        <View key={g.farmId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="callout" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
            {g.farm.name} · {tr('checkout.items', { count: g.items.length })}
          </Text>
          <Text variant="callout" numeric>
            {kes(g.items.reduce((s, l) => s + Math.round(l.quantity * l.pricePerUnit), 0))}
          </Text>
        </View>
      ))}
      <Divider />
      <SummaryRow label={tr('cart.subtotal')} value={kes(subtotal)} />
      <SummaryRow label={tr('cart.deliveryFee')} value={kes(deliveryFee)} />
      <SummaryRow label={tr('cart.total')} value={kes(total)} strong />
      {chosenDate && (
        <Text variant="caption" tone="tertiary">
          {tr('checkout.arrives', { date: dateLong(chosenDate), window: chosenWindow?.replace('-', ' to ') })}
        </Text>
      )}
    </Card>
  );

  const alerts = (
    <>
      {formError && <Banner tone="danger" message={formError} />}
      {problems.length > 0 && (
        <Banner
          tone="warning"
          title={tr('checkout.changedTitle')}
          message={problems.map((p) => p.message).join(' ')}
        />
      )}
      {slots.error ? (
        <Banner
          tone="danger"
          message={humanError(slots.error)}
          action={{ label: tr('common.retry'), onPress: () => slots.refetch() }}
        />
      ) : noSlots ? (
        <Banner tone="warning" message={tr('checkout.noSlots')} />
      ) : null}
      {quote.error ? (
        <Banner
          tone="warning"
          message={humanError(quote.error)}
          action={{ label: tr('common.retry'), onPress: () => quote.refetch() }}
        />
      ) : null}
    </>
  );

  const placeButton = (
    <Button
      label={method === 'MPESA' ? tr('checkout.payNow', { amount: kes(total) }) : tr('checkout.placeOrder')}
      onPress={place}
      loading={busy}
      disabled={!!blockReason || waiting}
      accessibilityHint={blockReason ?? undefined}
      haptics="medium"
    />
  );

  return (
    <Screen header={<Header title={tr('checkout.title')} />} footer={wide ? undefined : placeButton}>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 32, alignItems: 'flex-start', paddingTop: 8 }}>
          <View style={{ flex: 1.4, gap: 16 }}>
            {alerts}
            {delivery}
            {payment}
          </View>
          <View style={{ flex: 1, maxWidth: 400, gap: 16 }}>
            {summary}
            {placeButton}
          </View>
        </View>
      ) : (
        <View style={{ gap: 16, paddingTop: 4 }}>
          {alerts}
          {delivery}
          {payment}
          {summary}
        </View>
      )}

      <Sheet visible={addrOpen} onClose={() => setAddrOpen(false)} title={tr('checkout.deliverTo')}>
        <View style={{ gap: 8 }}>
          {savedList.map((a) => (
            <RadioRow
              key={a.id}
              label={a.label}
              description={addressLine(a)}
              selected={chosenSaved?.id === a.id}
              onPress={() => {
                setChoice(a.id);
                setAddrOpen(false);
              }}
            />
          ))}
          <RadioRow
            label={tr('checkout.newAddress')}
            description={tr('checkout.newAddressBody')}
            selected={!chosenSaved}
            onPress={() => {
              setChoice('new');
              setAddrOpen(false);
            }}
          />
          <Button
            label={tr('checkout.manageAddresses')}
            variant="ghost"
            icon="location"
            onPress={() => {
              setAddrOpen(false);
              router.push('/addresses');
            }}
          />
        </View>
      </Sheet>
      <CountyPicker
        visible={countyOpen}
        onClose={() => setCountyOpen(false)}
        value={county}
        onSelect={setCounty}
      />
      <Sheet
        visible={slotOpen}
        onClose={() => setSlotOpen(false)}
        title={tr('checkout.time')}
        subtitle={tr('checkout.timeHint')}
        footer={<Button label={tr('common.done')} onPress={() => setSlotOpen(false)} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(slots.data ?? []).map((s) => (
            <Chip
              key={s.date}
              label={relativeDay(s.date)}
              selected={s.date === chosenDate}
              onPress={() => setDate(s.date)}
            />
          ))}
        </View>
        <View style={{ gap: 10 }}>
          {(slotDay?.windows ?? []).map((w) => (
            <RadioRow
              key={w.value}
              label={w.label}
              description={w.available ? undefined : w.reason}
              selected={w.value === chosenWindow}
              disabled={!w.available}
              onPress={() => setWindow(w.value)}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text variant={strong ? 'title3' : 'callout'} tone={strong ? 'default' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'title3' : 'bodyStrong'} numeric>
        {value}
      </Text>
    </View>
  );
}
