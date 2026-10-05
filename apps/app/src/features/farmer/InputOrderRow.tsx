import type { InputOrderListItemDto } from '@farmgo/contracts';
import { normalizeKenyanPhone } from '@farmgo/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../data/session';
import { humanError } from '../../lib/errors';
import { dateShort, kes, qty, unitLabel } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Card, Chip, Pill, type Tone } from '../../ui/Controls';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { PhoneField, toLocalDigits } from '../../ui/PhoneAndCode';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { useInputOrderAction } from './data';

export const INPUT_CATEGORIES = [
  'COMPOST',
  'ORGANIC_FERTILIZER',
  'SEEDLINGS',
  'BIOPESTICIDE',
  'PACKAGING',
  'OTHER',
] as const;

export function inputOrderStatus(status: string): { labelKey: string; tone: Tone } {
  const tone: Record<string, Tone> = {
    PENDING: 'warning',
    ACCEPTED: 'brand',
    DISPATCHED: 'info',
    DELIVERED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
  };
  return { labelKey: `inputs.status.${status}`, tone: tone[status] ?? 'neutral' };
}

const REASONS = ['QUALITY', 'QUANTITY', 'DAMAGED', 'LATE', 'OTHER'] as const;

/** A green-input order I placed, with the moves open to me as the buyer. */
export function InputOrderRow({ o }: { o: InputOrderListItemDto }) {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const action = useInputOrderAction(o.id);
  const [payOpen, setPayOpen] = useState(false);
  const [phone, setPhone] = useState(me?.user.phoneNumber ? toLocalDigits(me.user.phoneNumber) : '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [problemOpen, setProblemOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [description, setDescription] = useState('');
  const [problemError, setProblemError] = useState<string | null>(null);
  const s = inputOrderStatus(o.status);
  const n = Number(o.quantity);
  const unpaid = o.paymentStatus === 'UNPAID' && ['PENDING', 'ACCEPTED'].includes(o.status);

  const run = async (path: 'transition' | 'pay' | 'dispute', body: unknown, success: string) => {
    try {
      await action.mutateAsync({ path, body });
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(humanError(err));
      return false;
    }
  };
  const cancel = async () => {
    const ok = await dialog.confirm({
      title: tr('inputs.cancelTitle'),
      message: tr('inputs.cancelBody'),
      confirmLabel: tr('inputs.cancel'),
      destructive: true,
    });
    if (ok) await run('transition', { to: 'CANCELLED' }, tr('inputs.cancelled'));
  };
  const received = async () => {
    const ok = await dialog.confirm({
      title: tr('inputs.receivedTitle'),
      message: tr('inputs.receivedBody'),
      confirmLabel: tr('inputs.receivedConfirm'),
      icon: 'checkCircle',
    });
    if (ok) await run('transition', { to: 'DELIVERED' }, tr('inputs.receivedDone'));
  };
  const pay = async () => {
    const msisdn = normalizeKenyanPhone(`0${toLocalDigits(phone)}`);
    if (!msisdn) return setPhoneError(tr('auth.errors.phone'));
    if (await run('pay', { phoneNumber: msisdn }, tr('orders.checkPhone'))) setPayOpen(false);
  };
  const report = async () => {
    if (!reason) return setProblemError(tr('report.pickReason'));
    if (description.trim().length < 10) return setProblemError(tr('report.describeMore'));
    if (await run('dispute', { reason, description: description.trim(), photos: [] }, tr('report.sent')))
      setProblemOpen(false);
  };

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{o.product.name}</Text>
          <Text variant="caption" tone="secondary" numeric>
            {qty(n)} {unitLabel(o.product.unit, n)} · {dateShort(o.createdAt)}
          </Text>
        </View>
        <Text variant="headline" numeric>
          {kes(o.total)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Pill label={tr(s.labelKey)} tone={s.tone} size="sm" />
        {unpaid && <Pill label={tr('orders.pay_UNPAID')} tone="warning" size="sm" />}
        {o.paymentStatus === 'PENDING' && ['PENDING', 'ACCEPTED'].includes(o.status) && (
          <Pill label={tr('orders.pay_PENDING')} tone="info" icon="clock" size="sm" />
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {unpaid && (
          <Button
            label={tr('orders.pay', { amount: kes(o.total) })}
            icon="phone"
            size="sm"
            fullWidth={false}
            onPress={() => setPayOpen(true)}
          />
        )}
        {o.status === 'DISPATCHED' && (
          <Button
            label={tr('inputs.receivedConfirm')}
            icon="checkCircle"
            size="sm"
            fullWidth={false}
            onPress={received}
            loading={action.isPending}
          />
        )}
        {o.status === 'DISPATCHED' && (
          <Button
            label={tr('orders.report')}
            icon="flag"
            variant="outline"
            size="sm"
            fullWidth={false}
            onPress={() => setProblemOpen(true)}
          />
        )}
        {o.status === 'PENDING' && (
          <Button label={tr('inputs.cancel')} variant="ghost" size="sm" fullWidth={false} onPress={cancel} />
        )}
      </View>
      {o.status === 'PENDING' && (
        <Text variant="caption" tone="tertiary">
          {tr('inputs.pendingNote')}
        </Text>
      )}
      <Sheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        title={tr('orders.payTitle')}
        subtitle={tr('orders.payBody', { amount: kes(o.total) })}
        footer={
          <Button
            label={tr('orders.pay', { amount: kes(o.total) })}
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
            setPhoneError(null);
          }}
          error={phoneError}
        />
      </Sheet>
      <Sheet
        visible={problemOpen}
        onClose={() => setProblemOpen(false)}
        title={tr('report.title')}
        subtitle={tr('inputs.problemBody')}
        footer={
          <Button label={tr('report.submit')} icon="flag" onPress={report} loading={action.isPending} />
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REASONS.map((r) => (
            <Chip
              key={r}
              label={tr(`report.reasons.${r}`)}
              selected={reason === r}
              onPress={() => {
                setReason(r);
                setProblemError(null);
              }}
            />
          ))}
        </View>
        <TextField
          label={tr('report.describe')}
          value={description}
          onChangeText={(v) => {
            setDescription(v);
            setProblemError(null);
          }}
          multiline
          maxLength={2000}
          error={problemError}
        />
      </Sheet>
    </Card>
  );
}
