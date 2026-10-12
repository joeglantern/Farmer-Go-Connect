import type { ListingCheckInput, OwnListingDto } from '@farmgo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { callPhone, openDirections, useQaListing } from '../../../../features/qa/data';
import { PhotoStrip, type UploadedPhoto } from '../../../../features/qa/PhotoStrip';
import { api } from '../../../../lib/api';
import { humanError } from '../../../../lib/errors';
import { dateShort, kes, produceName, qty, unitLabel } from '../../../../lib/format';
import { useTheme } from '../../../../theme/theme';
import { Button, IconButton } from '../../../../ui/Button';
import { Card, Chip, Segmented } from '../../../../ui/Controls';
import { Icon } from '../../../../ui/Icon';
import { ProduceImage } from '../../../../ui/Media';
import { useDialog } from '../../../../ui/overlays/Dialog';
import { useToast } from '../../../../ui/overlays/Toast';
import { Header, Screen } from '../../../../ui/Screen';
import { SkeletonList } from '../../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { TextField } from '../../../../ui/TextField';

type Decision = 'approve' | 'reject';

/** A QA officer checks a new listing at the farm: approve it with a grade, or send it back with a note. */
export default function CheckListing() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQaListing(id);
  const l = q.data;
  const grades = l?.produce.grades.length ? l.produce.grades : ['A', 'B', 'C'];

  const [decision, setDecision] = useState<Decision>('approve');
  const [grade, setGrade] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (l && grade === null) setGrade(l.grade && grades.includes(l.grade) ? l.grade : (grades[0] ?? 'A'));
  }, [l, grade, grades]);

  const noteError = decision === 'reject' && note.trim().length < 3 ? tr('qa.whyNot') : null;

  const submit = async () => {
    if (!l) return;
    if (noteError) {
      setShowErrors(true);
      toast.error(tr('qa.fixErrors'));
      return;
    }
    if (decision === 'reject') {
      const ok = await dialog.confirm({
        title: tr('qa.rejectConfirmTitle'),
        message: tr('qa.rejectConfirmBody'),
        confirmLabel: tr('qa.submitReject'),
        destructive: true,
        icon: 'warning',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const body: ListingCheckInput = {
        passed: decision === 'approve',
        grade: decision === 'approve' ? (grade ?? undefined) : undefined,
        note: note.trim() || undefined,
        photos: photos.map((p) => p.key),
      };
      await api.post<OwnListingDto>(`/v1/qa/listings/${l.id}/check`, body);
      toast.success(decision === 'approve' ? tr('qa.approvedToast') : tr('qa.rejectedToast'));
      void qc.invalidateQueries({ queryKey: ['qaListings'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.back();
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setSaving(false);
    }
  };

  const header = <Header title={tr('qa.checkListing')} subtitle={l?.farm.name} />;

  if (q.isLoading) {
    return (
      <Screen header={header}>
        <SkeletonList count={3} height={140} />
      </Screen>
    );
  }
  if (q.error) {
    return (
      <Screen header={header}>
        <ErrorState onRetry={() => q.refetch()} message={humanError(q.error)} />
      </Screen>
    );
  }
  if (!l) {
    return (
      <Screen header={header}>
        <EmptyState
          art="noListings"
          title={tr('qa.listingGone')}
          action={{ label: tr('qa.tasksTitle'), icon: 'shield', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const farmer = l.farm.farmer.user;
  const amount = Number(l.quantity);

  return (
    <Screen
      header={header}
      footer={
        <Button
          label={decision === 'approve' ? tr('qa.submitApprove') : tr('qa.submitReject')}
          icon={decision === 'approve' ? 'shield' : 'warning'}
          variant={decision === 'approve' ? 'primary' : 'danger'}
          onPress={submit}
          loading={saving}
        />
      }
    >
      <View style={{ gap: 16 }}>
        <Card style={{ gap: 14 }}>
          <View style={styles.row}>
            <ProduceImage
              uri={l.photoUrls[0] ?? l.produce.imageUrl}
              produce={l.produce}
              category={l.produce.category}
              size={72}
              radius={14}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="title3">{produceName(l.produce)}</Text>
              <Text variant="bodyStrong" numeric>
                {qty(amount)} {unitLabel(l.produce.unit, amount)}, {kes(l.pricePerUnit)}{' '}
                <Text variant="callout" tone="secondary">
                  {tr('common.perUnit', { unit: unitLabel(l.produce.unit) })}
                </Text>
              </Text>
              <Text variant="caption" tone="secondary">
                {tr('farmer.dateRange', { from: dateShort(l.availableFrom), to: dateShort(l.availableTo) })}
              </Text>
            </View>
          </View>
          <View style={styles.farmRow}>
            <Icon name="location" size={16} color={t.colors.primary} weight="fill" />
            <Text variant="callout" tone="secondary" style={{ flex: 1 }} numberOfLines={2}>
              {[farmer.name, l.farm.name, l.farm.ward, l.farm.county].filter(Boolean).join(', ')}
            </Text>
            <IconButton
              icon="phone"
              label={tr('qa.callFarmer', { name: farmer.name })}
              variant="tinted"
              onPress={() => callPhone(farmer.phoneNumber)}
              disabled={!farmer.phoneNumber}
            />
            <IconButton
              icon="navigate"
              label={tr('qa.directions')}
              variant="tinted"
              onPress={() => openDirections(l.farm.lat, l.farm.lng, l.farm.name)}
            />
          </View>
          {l.notes ? (
            <Text variant="callout" tone="secondary">
              {l.notes}
            </Text>
          ) : null}
        </Card>

        <Card style={{ gap: 10 }}>
          <Text variant="headline" accessibilityRole="header">
            {tr('qa.farmerPhotos')}
          </Text>
          {l.photoUrls.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {l.photoUrls.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 14,
                    backgroundColor: t.colors.surfaceMuted,
                  }}
                  contentFit="cover"
                  accessibilityIgnoresInvertColors
                />
              ))}
            </ScrollView>
          ) : (
            <Text variant="callout" tone="tertiary">
              {tr('qa.noFarmerPhotos')}
            </Text>
          )}
        </Card>

        <Card style={{ gap: 14 }}>
          <Text variant="headline" accessibilityRole="header">
            {tr('qa.decision')}
          </Text>
          <Segmented
            value={decision}
            onChange={setDecision}
            options={[
              { value: 'approve', label: tr('qa.approve') },
              { value: 'reject', label: tr('qa.notApprove') },
            ]}
          />
          {decision === 'approve' && (
            <View style={{ gap: 8 }}>
              <Text variant="calloutStrong">{tr('qa.grade')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {grades.map((g) => (
                  <Chip key={g} label={g} selected={grade === g} onPress={() => setGrade(g)} />
                ))}
              </View>
            </View>
          )}
          <TextField
            label={decision === 'reject' ? tr('qa.whyNot') : tr('qa.noteForFarmer')}
            hint={tr('qa.whyNotHint')}
            optional={decision === 'approve'}
            value={note}
            onChangeText={setNote}
            error={showErrors ? noteError : null}
            multiline
            maxLength={500}
          />
          <View style={{ gap: 8 }}>
            <Text variant="calloutStrong">{tr('qa.yourPhotos')}</Text>
            <PhotoStrip bucket="qa-evidence" photos={photos} onChange={setPhotos} max={6} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  farmRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
