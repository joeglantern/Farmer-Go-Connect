import { normalizeKenyanPhone } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useSession } from '../../data/session';
import { ApiError, api } from '../../lib/api';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP } from '../../lib/config';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { downloadMyData } from './exportData';

const REMOVED = ['profile', 'farms', 'devices'] as const;
const KEPT = ['history', 'money'] as const;

type Blocker =
  | { kind: 'orders'; count: number }
  | { kind: 'payouts' }
  | { kind: 'other'; message: string }
  | null;

/** Account deletion (B18): POST /v1/me/delete-request after a typed confirmation. */
export function DeleteAccountScreen() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const dialog = useDialog();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [blocker, setBlocker] = useState<Blocker>(null);
  const [done, setDone] = useState(false);

  const phone = me?.user.phoneNumber ?? null;
  const word = tr('deleteAccount.typeWord');
  const confirmed =
    typed.trim().toUpperCase() === word.toUpperCase() ||
    typed.trim().toUpperCase() === 'DELETE' ||
    (!!phone && normalizeKenyanPhone(typed) === phone);

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadMyData();
      toast.success(tr('dataExport.done'));
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setExporting(false);
    }
  };

  const submit = async () => {
    if (!confirmed) return;
    const ok = await dialog.confirm({
      title: tr('deleteAccount.confirmTitle'),
      message: tr('deleteAccount.confirmBody'),
      confirmLabel: tr('deleteAccount.request'),
      destructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    setBusy(true);
    setBlocker(null);
    try {
      await api.post('/v1/me/delete-request');
      setDone(true);
      // The server has already ended every session; drop the local copy after the goodbye.
      setTimeout(() => {
        void useSession
          .getState()
          .signOut()
          .finally(() => router.replace('/welcome'));
      }, 2500);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_HAS_OPEN_ORDERS') {
        const count = Number((err.details as { openOrders?: number } | undefined)?.openOrders ?? 0);
        setBlocker({ kind: 'orders', count });
      } else if (err instanceof ApiError && err.code === 'ACCOUNT_HAS_UNPAID_PAYOUTS') {
        setBlocker({ kind: 'payouts' });
      } else {
        setBlocker({ kind: 'other', message: humanError(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen header={<Header title={tr('deleteAccount.title')} back={false} />} maxWidth={640}>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 48 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: t.colors.primaryTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="leaf" size={32} color={t.colors.primary} weight="fill" />
          </View>
          <Text variant="title2" align="center" accessibilityRole="header">
            {tr('deleteAccount.goodbyeTitle')}
          </Text>
          <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 420 }}>
            {tr('deleteAccount.goodbyeBody')}
          </Text>
        </View>
      </Screen>
    );
  }

  const support = [SUPPORT_WHATSAPP, SUPPORT_PHONE, SUPPORT_EMAIL].some(Boolean);

  return (
    <Screen
      header={<Header title={tr('deleteAccount.title')} />}
      maxWidth={640}
      footer={
        <Button
          label={tr('deleteAccount.request')}
          variant="danger"
          onPress={submit}
          loading={busy}
          disabled={!confirmed}
        />
      }
    >
      <View style={{ gap: 18, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: t.colors.dangerTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="trash" size={22} color={t.colors.danger} />
          </View>
          <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
            {tr('deleteAccount.intro')}
          </Text>
        </View>

        <Card style={{ gap: 12 }}>
          <Text variant="headline">{tr('deleteAccount.removedTitle')}</Text>
          {REMOVED.map((k) => (
            <Point key={k} icon="close" text={tr(`deleteAccount.items.${k}`)} />
          ))}
          <Text variant="headline" style={{ marginTop: 6 }}>
            {tr('deleteAccount.keptTitle')}
          </Text>
          {KEPT.map((k) => (
            <Point key={k} icon="receipt" text={tr(`deleteAccount.items.${k}`)} />
          ))}
        </Card>

        <ListGroup title={tr('dataExport.group')} footer={tr('dataExport.hint')}>
          <ListRow
            key="export"
            icon="download"
            label={exporting ? tr('dataExport.preparing') : tr('dataExport.title')}
            onPress={exporting ? undefined : exportData}
          />
        </ListGroup>

        {blocker?.kind === 'orders' && (
          <Banner
            tone="warning"
            title={tr('deleteAccount.openOrdersTitle', { count: blocker.count })}
            message={tr('deleteAccount.openOrdersBody')}
            action={{ label: tr('deleteAccount.viewOrders'), onPress: () => router.push('/orders') }}
          />
        )}
        {blocker?.kind === 'payouts' && (
          <Banner
            tone="warning"
            title={tr('deleteAccount.payoutsTitle')}
            message={tr('deleteAccount.payoutsBody')}
            action={{ label: tr('deleteAccount.viewEarnings'), onPress: () => router.push('/earnings') }}
          />
        )}
        {blocker?.kind === 'other' && (
          <View style={{ gap: 12 }}>
            <Banner tone="danger" title={tr('deleteAccount.failedTitle')} message={blocker.message} />
            {support && (
              <ListGroup title={tr('help.contact')}>
                {SUPPORT_WHATSAPP ? (
                  <ListRow
                    key="wa"
                    icon="chat"
                    label={tr('profile.whatsapp')}
                    external
                    onPress={() =>
                      void Linking.openURL(`https://wa.me/${(SUPPORT_WHATSAPP ?? '').replace(/\D/g, '')}`)
                    }
                  />
                ) : null}
                {SUPPORT_PHONE ? (
                  <ListRow
                    key="call"
                    icon="phone"
                    label={tr('profile.callUs')}
                    value={SUPPORT_PHONE}
                    onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
                  />
                ) : null}
                {SUPPORT_EMAIL ? (
                  <ListRow
                    key="mail"
                    icon="mail"
                    label={tr('profile.emailUs')}
                    value={SUPPORT_EMAIL}
                    external
                    onPress={() =>
                      void Linking.openURL(
                        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(tr('deleteAccount.emailSubject'))}`,
                      )
                    }
                  />
                ) : null}
              </ListGroup>
            )}
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text variant="calloutStrong">{tr('deleteAccount.typeLabel', { word })}</Text>
          <Text variant="caption" tone="secondary">
            {phone ? tr('deleteAccount.typeHintPhone', { word }) : tr('deleteAccount.typeHint', { word })}
          </Text>
          <TextField
            value={typed}
            onChangeText={setTyped}
            placeholder={word}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel={tr('deleteAccount.typeLabel', { word })}
            onSubmitEditing={submit}
          />
        </View>
      </View>
    </Screen>
  );
}

function Point({ icon, text }: { icon: 'close' | 'receipt'; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Icon name={icon} size={18} color={icon === 'close' ? t.colors.danger : t.colors.textSecondary} />
      <Text variant="callout" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
