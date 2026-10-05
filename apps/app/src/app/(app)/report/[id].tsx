import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useOrder, useOrderAction } from '../../../data/orders';
import { PhotoStrip, type UploadedPhoto } from '../../../features/qa/PhotoStrip';
import { humanError } from '../../../lib/errors';
import { Button } from '../../../ui/Button';
import { Card, RadioRow } from '../../../ui/Controls';
import { Banner } from '../../../ui/overlays/Banner';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

type DisputeReason = 'QUALITY' | 'QUANTITY' | 'LATE' | 'DAMAGED' | 'OTHER';

const REASONS: DisputeReason[] = ['QUALITY', 'QUANTITY', 'DAMAGED', 'LATE', 'OTHER'];

/** Report a problem with a delivered order. Holds the farmer's payout until an admin resolves it. */
export default function ReportProblem() {
  const { t: tr } = useTranslation();
  const toast = useToast();
  const dialog = useDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const action = useOrderAction(id);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [errors, setErrors] = useState<{ reason?: string; description?: string }>({});
  const dirty = !!reason || description.length > 0 || photos.length > 0;

  const submit = async () => {
    const next: typeof errors = {};
    if (!reason) next.reason = tr('report.pickReason');
    if (description.trim().length < 10) next.description = tr('report.describeMore');
    setErrors(next);
    if (next.reason || next.description) return;
    try {
      await action.mutateAsync({
        path: 'dispute',
        body: { reason, description: description.trim(), photos: photos.map((p) => p.key) },
      });
      toast.success(tr('report.sent'));
      router.back();
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const leave = async () => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: tr('report.discardTitle'),
        message: tr('report.discardBody'),
        confirmLabel: tr('report.discard'),
        destructive: true,
      }))
    )
      return;
    router.back();
  };

  return (
    <Screen
      header={<Header title={tr('report.title')} subtitle={order.data?.code} onBack={leave} />}
      maxWidth={640}
      footer={<Button label={tr('report.submit')} icon="flag" onPress={submit} loading={action.isPending} />}
    >
      <View style={{ gap: 20, paddingTop: 4 }}>
        <Banner tone="info" message={tr('report.holdNote')} />
        <View style={{ gap: 8 }}>
          <Text variant="headline" accessibilityRole="header">
            {tr('report.whatWrong')}
          </Text>
          <Card padded={false}>
            {REASONS.map((r) => (
              <RadioRow
                key={r}
                label={tr(`report.reasons.${r}`)}
                description={tr(`report.reasonHints.${r}`)}
                selected={reason === r}
                onPress={() => {
                  setReason(r);
                  setErrors((e) => ({ ...e, reason: undefined }));
                }}
              />
            ))}
          </Card>
          {errors.reason && (
            <Text variant="caption" tone="danger">
              {errors.reason}
            </Text>
          )}
        </View>
        <TextField
          label={tr('report.describe')}
          value={description}
          onChangeText={(v) => {
            setDescription(v);
            setErrors((e) => ({ ...e, description: undefined }));
          }}
          multiline
          maxLength={2000}
          placeholder={tr('report.describePlaceholder')}
          error={errors.description}
        />
        <View style={{ gap: 8 }}>
          <Text variant="headline">{tr('report.photos')}</Text>
          <Text variant="caption" tone="secondary">
            {tr('report.photosHint')}
          </Text>
          <PhotoStrip bucket="chat" photos={photos} onChange={setPhotos} max={6} />
        </View>
      </View>
    </Screen>
  );
}
