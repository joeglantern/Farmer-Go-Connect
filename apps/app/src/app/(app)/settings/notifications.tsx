import type { NotificationPrefsDto } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { Stepper, Switch } from '../../../ui/Controls';
import { ListGroup } from '../../../ui/ListRow';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

type Prefs = Pick<NotificationPrefsDto, 'sms' | 'push' | 'email' | 'quietFrom' | 'quietTo'>;

/** Channels and quiet hours (GET/PATCH /v1/notifications/preferences). Saves as you change. */
export default function NotificationSettings() {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notificationPrefs'],
    queryFn: () => api.get<NotificationPrefsDto>('/v1/notifications/preferences'),
  });
  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) =>
      api.patch<NotificationPrefsDto>('/v1/notifications/preferences', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['notificationPrefs'] });
      const prev = qc.getQueryData<NotificationPrefsDto>(['notificationPrefs']);
      if (prev) qc.setQueryData(['notificationPrefs'], { ...prev, ...patch });
      return { prev };
    },
    onError: (err, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notificationPrefs'], ctx.prev);
      toast.error(humanError(err));
    },
  });

  const p = prefs.data;
  const quiet = p?.quietFrom != null && p?.quietTo != null;

  return (
    <Screen header={<Header title={tr('profile.notificationSettings')} />} maxWidth={620}>
      {prefs.isLoading ? (
        <View style={{ gap: 12, paddingTop: 8 }}>
          <Skeleton height={180} radius={14} />
          <Skeleton height={120} radius={14} />
        </View>
      ) : prefs.error || !p ? (
        <ErrorState onRetry={() => prefs.refetch()} />
      ) : (
        <View style={{ gap: 22, paddingTop: 8 }}>
          <ListGroup title={tr('notifPrefs.channels')} footer={tr('notifPrefs.channelsFooter')}>
            <View key="push" style={{ paddingHorizontal: 14 }}>
              <Switch
                value={p.push}
                onChange={(v) => save.mutate({ push: v })}
                label={tr('notifPrefs.push')}
                description={tr('notifPrefs.pushBody')}
              />
            </View>
            <View key="sms" style={{ paddingHorizontal: 14 }}>
              <Switch
                value={p.sms}
                onChange={(v) => save.mutate({ sms: v })}
                label={tr('notifPrefs.sms')}
                description={tr('notifPrefs.smsBody')}
              />
            </View>
            <View key="email" style={{ paddingHorizontal: 14 }}>
              <Switch
                value={p.email}
                onChange={(v) => save.mutate({ email: v })}
                label={tr('notifPrefs.email')}
                description={tr('notifPrefs.emailBody')}
              />
            </View>
          </ListGroup>
          <ListGroup title={tr('notifPrefs.quiet')} footer={tr('notifPrefs.quietFooter')}>
            <View key="quiet" style={{ paddingHorizontal: 14 }}>
              <Switch
                value={quiet}
                onChange={(v) =>
                  save.mutate(v ? { quietFrom: 21, quietTo: 6 } : { quietFrom: null, quietTo: null })
                }
                label={tr('notifPrefs.quietOn')}
              />
            </View>
            {quiet ? (
              <View key="hours" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 14 }}>
                <HourRow
                  label={tr('notifPrefs.from')}
                  value={p.quietFrom!}
                  onChange={(h) => save.mutate({ quietFrom: h })}
                />
                <HourRow
                  label={tr('notifPrefs.to')}
                  value={p.quietTo!}
                  onChange={(h) => save.mutate({ quietTo: h })}
                />
              </View>
            ) : null}
          </ListGroup>
        </View>
      )}
    </Screen>
  );
}

function HourRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Stepper
        value={value}
        onChange={(v) => onChange(((v % 24) + 24) % 24)}
        min={-1}
        max={24}
        step={1}
        unit=":00"
        size="sm"
        label={label}
      />
    </View>
  );
}
