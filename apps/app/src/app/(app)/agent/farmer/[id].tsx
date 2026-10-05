import type { AgentFarmerDetailDto, FarmDto } from '@farmgo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { kycView, prettyPhone, useAgentFarmer } from '../../../../features/agent/data';
import {
  emptyFarm,
  type FarmDraft,
  FarmFields,
  farmBody,
  farmErrors,
} from '../../../../features/agent/FarmFields';
import { callPhone, openDirections } from '../../../../features/qa/data';
import { Stat } from '../../../../features/qa/QaTasks';
import { api } from '../../../../lib/api';
import { humanError } from '../../../../lib/errors';
import { dateShort, kes, produceName, qty, unitLabel } from '../../../../lib/format';
import { useSizeClass, useTheme } from '../../../../theme/theme';
import { Button, IconButton } from '../../../../ui/Button';
import { Avatar, Card, Divider, Pill, type Tone } from '../../../../ui/Controls';
import { Icon } from '../../../../ui/Icon';
import { ProduceImage } from '../../../../ui/Media';
import { Banner } from '../../../../ui/overlays/Banner';
import { Sheet } from '../../../../ui/overlays/Sheet';
import { useToast } from '../../../../ui/overlays/Toast';
import { Header, Screen, SectionTitle } from '../../../../ui/Screen';
import { Skeleton, SkeletonList } from '../../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';

const pct = (n: number) => `${Math.round((n > 1 ? n : n * 100) || 0)}%`;

/** A farmer the agent registered: contact, performance, farms and what each farm is selling. */
export default function AgentFarmer() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const farmer = useAgentFarmer(id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<FarmDraft>(emptyFarm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const f = farmer.data;
  const header = (
    <Header title={f?.user.name ?? tr('agent.farmerTitle')} subtitle={f?.user.county ?? undefined} />
  );

  if (farmer.isLoading) {
    return (
      <Screen header={header}>
        <View style={{ gap: 16 }}>
          <Skeleton height={140} radius={14} />
          <SkeletonList count={2} height={160} />
        </View>
      </Screen>
    );
  }
  if (farmer.error) {
    return (
      <Screen header={header}>
        <ErrorState onRetry={() => void farmer.refetch()} message={humanError(farmer.error)} />
      </Screen>
    );
  }
  if (!f) {
    return (
      <Screen header={header}>
        <EmptyState
          art="noResults"
          title={tr('agent.farmerGone')}
          action={{ label: tr('agent.backToFarmers'), onPress: () => router.back(), icon: 'back' }}
        />
      </Screen>
    );
  }

  const kyc = kycView(f.kycStatus);
  const perf = f.performance;
  const wide = size !== 'compact';

  const openAdd = () => {
    setDraft(emptyFarm(f.user.county));
    setErrors({});
    setSheetError(null);
    setAdding(true);
  };

  const saveFarm = async () => {
    const e = farmErrors(draft, tr);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setSheetError(null);
    try {
      await api.post<FarmDto>(`/v1/agent/farmers/${f.id}/farms`, farmBody(draft));
      await qc.invalidateQueries({ queryKey: ['agentFarmers'] });
      setAdding(false);
      toast.success(tr('agent.farmAdded', { name: draft.name.trim() }));
    } catch (err) {
      setSheetError(humanError(err));
    } finally {
      setSaving(false);
    }
  };

  const profile = (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 16 }}>
        <View style={styles.row}>
          <Avatar name={f.user.name} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title2">{f.user.name}</Text>
            <Text variant="callout" tone="secondary" numeric>
              {prettyPhone(f.user.phoneNumber)}
            </Text>
            <Text variant="caption" tone="tertiary">
              {tr('agent.since', { date: dateShort(f.createdAt) })}
            </Text>
          </View>
          <IconButton
            icon="phone"
            label={tr('agent.call', { name: f.user.name })}
            variant="tinted"
            disabled={!f.user.phoneNumber}
            onPress={() => callPhone(f.user.phoneNumber)}
          />
        </View>
        <View style={styles.pills}>
          <Pill label={tr(kyc.labelKey)} tone={kyc.tone} icon="idCard" size="sm" />
          {f.user.phoneNumberVerified ? (
            <Pill label={tr('agent.phoneVerified')} tone="success" icon="checkCircle" size="sm" />
          ) : (
            <Pill label={tr('agent.phoneUnverified')} tone="neutral" icon="phone" size="sm" />
          )}
        </View>
        <Divider />
        <View style={styles.kv}>
          <Text variant="callout" tone="secondary">
            {tr('agent.mpesa')}
          </Text>
          <Text variant="calloutStrong" numeric>
            {prettyPhone(f.mpesaNumber)}
          </Text>
        </View>
      </Card>
      {f.kycStatus !== 'VERIFIED' && (
        <Banner tone="info" title={tr('agent.kycTitle')} message={tr('agent.kycBody')} />
      )}
      <View style={styles.stats}>
        {(
          [
            ['agent.orders', `${perf.ordersCompleted}/${perf.ordersTotal}`, 'orders'],
            ['agent.qaRate', perf.ordersCompleted ? pct(perf.qaPassRate) : '·', 'shield'],
            ['agent.onTime', perf.ordersCompleted ? pct(perf.onTimeRate) : '·', 'clock'],
            ['agent.paidOut', kes(perf.paidOutCents), 'wallet'],
          ] as const
        ).map(([label, value, icon]) => (
          <View key={label} style={styles.statCell}>
            <Stat label={tr(label)} value={value} icon={icon} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <Screen header={header} refreshing={farmer.isRefetching} onRefresh={() => void farmer.refetch()}>
      <View style={[{ gap: 24 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={wide ? { width: 380 } : undefined}>{profile}</View>
        <View style={{ flex: 1, gap: 12 }}>
          <SectionTitle
            title={tr('agent.farms')}
            action={f.farms.length ? tr('agent.addFarm') : undefined}
            onAction={openAdd}
          />
          {f.farms.length === 0 ? (
            <Card>
              <EmptyState
                compact
                art="noListings"
                title={tr('agent.noFarmsTitle')}
                body={tr('agent.noFarmsBody')}
                action={{ label: tr('agent.addFarm'), onPress: openAdd, icon: 'plus' }}
              />
            </Card>
          ) : (
            f.farms.map((farm) => <FarmCard key={farm.id} farm={farm} />)
          )}
        </View>
      </View>

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title={tr('agent.addFarmTitle')}
        subtitle={tr('agent.addFarmFor', { name: f.user.name })}
        dismissible={!saving}
        footer={
          <Button
            label={tr('agent.saveFarm')}
            icon="checkCircle"
            loading={saving}
            onPress={() => void saveFarm()}
          />
        }
      >
        <View style={{ gap: 16 }}>
          {sheetError && <Banner tone="danger" message={sheetError} />}
          <FarmFields value={draft} onChange={setDraft} errors={errors} />
        </View>
      </Sheet>
    </Screen>
  );
}

const LISTING_TONE: Record<string, Tone> = {
  OPEN: 'success',
  PARTIALLY_MATCHED: 'info',
  FULLY_MATCHED: 'brand',
  DRAFT: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
};

function FarmCard({ farm }: { farm: AgentFarmerDetailDto['farms'][number] }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const listings = farm.listings;
  const live = listings.filter((l) => l.status === 'OPEN' || l.status === 'PARTIALLY_MATCHED');
  const shown = (live.length ? live : listings).slice(0, 4);

  return (
    <Card style={{ gap: 14 }}>
      <View style={styles.row}>
        <View style={[styles.farmIcon, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.sm }]}>
          <Icon name="farm" size={24} color={t.colors.primary} weight="duotone" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{farm.name}</Text>
          <Text variant="caption" tone="secondary">
            {[farm.ward, farm.county, farm.acreage ? tr('agent.acres', { n: farm.acreage }) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {farm.isOrganic && <Pill label={tr('agent.organicTag')} tone="success" icon="leaf" size="sm" />}
        <IconButton
          icon="navigate"
          label={tr('qa.directions')}
          variant="tinted"
          onPress={() => openDirections(farm.lat, farm.lng, farm.name)}
        />
      </View>
      {farm.lat == null && (
        <Text variant="caption" tone="warning">
          {tr('agent.noPin')}
        </Text>
      )}
      <Divider />
      {shown.length === 0 ? (
        <Text variant="callout" tone="tertiary">
          {tr('agent.noListings')}
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          <Text variant="caption" tone="secondary">
            {live.length ? tr('agent.onSale', { count: live.length }) : tr('agent.pastListings')}
          </Text>
          {shown.map((l) => (
            <View key={l.id} style={styles.row}>
              <ProduceImage
                uri={l.photoUrls[0] ?? l.produce.imageUrl}
                category={l.produce.category}
                produce={l.produce}
                size={44}
                radius={10}
              />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {produceName(l.produce)}
                </Text>
                <Text variant="caption" tone="tertiary" numeric>
                  {qty(l.quantityLeft)} {unitLabel(l.produce.unit, l.quantityLeft)} · {kes(l.pricePerUnit)}/
                  {unitLabel(l.produce.unit)}
                </Text>
              </View>
              <Pill
                label={tr(`agent.listing.${l.status}`)}
                tone={LISTING_TONE[l.status] ?? 'neutral'}
                size="sm"
              />
            </View>
          ))}
        </View>
      )}
      <Button
        label={tr('agent.listProduce')}
        icon="plus"
        variant="secondary"
        size="md"
        onPress={() => router.push({ pathname: '/sell', params: { farmId: farm.id } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCell: { flexBasis: '46%', flexGrow: 1 },
  farmIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
