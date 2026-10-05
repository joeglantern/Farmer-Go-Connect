import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateLong, dateShort, kes, produceName, qty, relativeDay, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ListGroup, ListRow } from '../../ui/ListRow';
import { Banner } from '../../ui/overlays/Banner';
import { useDialog } from '../../ui/overlays/Dialog';
import { useToast } from '../../ui/overlays/Toast';
import { Header, Screen, SectionTitle } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { type RequirementDetail, useRequirement, useRequirementMutations } from './data';
import { OPEN_STATUSES, repeatLabel } from './requirements';
import { StatusTag } from './StatusTag';

export function RequirementDetailScreen({ id }: { id: string }) {
  const { t: tr } = useTranslation();
  const req = useRequirement(id);
  const d = req.data;
  return (
    <Screen
      header={<Header title={d ? produceName(d.produce) : tr('requirements.title')} />}
      refreshing={req.isRefetching}
      onRefresh={() => req.refetch()}
    >
      {req.isLoading ? (
        <View style={{ gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={tr('common.loading')}>
          <Skeleton height={140} radius={14} />
          <Skeleton height={180} radius={14} />
        </View>
      ) : req.error || !d ? (
        <ErrorState
          message={
            (req.error as { status?: number } | null)?.status === 404
              ? tr('requirements.notFound')
              : humanError(req.error)
          }
          onRetry={() => req.refetch()}
        />
      ) : (
        <Body d={d} />
      )}
    </Screen>
  );
}

function Body({ d }: { d: RequirementDetail }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const { close, setPaused } = useRequirementMutations();
  const open = OPEN_STATUSES.includes(d.status);
  const paused = d.status === 'PAUSED';
  const repeat = repeatLabel(d.recurrence, d.neededBy);
  const unit = unitLabel(d.produce.unit, d.quantity);
  const proposed = d.matches.filter((m) => m.status === 'PROPOSED');

  const pauseOrResume = async (pause: boolean) => {
    if (pause) {
      const ok = await dialog.confirm({
        title: tr('requirements.pauseTitle'),
        message: repeat ? tr('requirements.pauseRecurringBody') : tr('requirements.pauseBody'),
        confirmLabel: tr('requirements.pause'),
        icon: 'timer',
      });
      if (!ok) return;
    }
    try {
      await setPaused.mutateAsync({ id: d.id, paused: pause });
      toast.success(pause ? tr('requirements.paused') : tr('requirements.resumed'));
    } catch (err) {
      // Someone else already paused or resumed it: the refetch shows the real state.
      const code = (err as { code?: string }).code;
      if (code === 'DEMAND_ALREADY_PAUSED' || code === 'DEMAND_NOT_PAUSED') return;
      toast.error(humanError(err));
    }
  };

  const doClose = async () => {
    const ok = await dialog.confirm({
      title: repeat ? tr('requirements.closeRecurringTitle') : tr('requirements.closeTitle'),
      message: repeat ? tr('requirements.closeRecurringBody') : tr('requirements.closeBody'),
      confirmLabel: tr('requirements.close'),
      destructive: true,
      icon: 'close',
    });
    if (!ok) return;
    try {
      await close.mutateAsync(d.id);
      toast.success(tr('requirements.closed', { name: produceName(d.produce) }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const summary = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="title3" style={{ flex: 1 }}>
          {tr('requirements.qtyOf', { qty: qty(d.quantity), unit })}
        </Text>
        <StatusTag status={d.status} />
      </View>
      <View style={styles.facts}>
        <Fact
          label={tr('requirements.neededBy')}
          value={`${dateLong(d.neededBy)} (${relativeDay(d.neededBy)})`}
        />
        <Fact
          label={tr('requirements.filledLabel')}
          value={`${qty(d.quantityFilled)} / ${qty(d.quantity)} ${unit}`}
        />
        <Fact
          label={tr('requirements.minGrade')}
          value={d.minGrade ? tr('requirements.gradeN', { grade: d.minGrade }) : tr('requirements.anyGrade')}
        />
        <Fact
          label={tr('requirements.maxPrice')}
          value={
            d.maxPricePerUnit
              ? `${kes(d.maxPricePerUnit)} ${tr('common.perUnit', { unit: unitLabel(d.produce.unit) })}`
              : tr('requirements.noMax')
          }
        />
        <Fact label={tr('requirements.county')} value={d.county} />
        {repeat && <Fact label={tr('requirements.repeat')} value={repeat} />}
      </View>
      {d.notes ? (
        <Text variant="callout" tone="secondary">
          {d.notes}
        </Text>
      ) : null}
      {open ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button
            label={tr('common.edit')}
            icon="edit"
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => router.push({ pathname: '/requirements/new', params: { id: d.id } })}
          />
          <Button
            label={tr('requirements.pause')}
            icon="timer"
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => pauseOrResume(true)}
            loading={setPaused.isPending}
          />
          <Button
            label={tr('requirements.close')}
            icon="close"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={doClose}
            loading={close.isPending}
          />
        </View>
      ) : paused ? (
        <View style={{ gap: 10 }}>
          <Banner
            tone="info"
            title={tr('requirements.pausedTitle')}
            message={tr('requirements.pausedBody')}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button
              label={tr('requirements.resume')}
              icon="refresh"
              size="sm"
              fullWidth={false}
              onPress={() => pauseOrResume(false)}
              loading={setPaused.isPending}
            />
            <Button
              label={tr('requirements.close')}
              icon="close"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={doClose}
              loading={close.isPending}
            />
          </View>
        </View>
      ) : (
        <Banner tone="info" message={tr('requirements.notOpen')} />
      )}
    </Card>
  );

  const upcoming =
    d.upcomingDates.length > 0 ? (
      <View>
        <SectionTitle title={tr('requirements.nextDeliveries')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {d.upcomingDates.map((u) => (
            <Pill key={u} label={dateShort(u)} tone="info" icon="calendar" />
          ))}
        </View>
      </View>
    ) : null;

  const matches = (
    <View>
      <SectionTitle
        title={tr('requirements.matchesTitle')}
        action={proposed.length ? tr('requirements.reviewMatches') : undefined}
        onAction={proposed.length ? () => router.push('/matches') : undefined}
      />
      {d.matches.length === 0 ? (
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} elevated={false}>
          <Icon name="handshake" size={22} color={t.colors.primary} />
          <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
            {open ? tr('requirements.noMatchesYet') : tr('requirements.noMatches')}
          </Text>
        </Card>
      ) : (
        <ListGroup>
          {d.matches.map((m) => (
            <ListRow
              key={m.id}
              icon="farm"
              label={m.listing.farm.name}
              detail={`${m.listing.farm.county} · ${qty(m.quantity)} ${unit} · ${kes(m.pricePerUnit)}`}
              value={tr(`requirements.matchStatus.${m.status}`, { defaultValue: m.status })}
              onPress={m.status === 'PROPOSED' ? () => router.push('/matches') : undefined}
            />
          ))}
        </ListGroup>
      )}
    </View>
  );

  const instances =
    d.children.length > 0 ? (
      <View>
        <SectionTitle title={tr('requirements.instances')} />
        <ListGroup>
          {d.children.map((c) => (
            <ListRow
              key={c.id}
              icon="calendar"
              label={dateLong(c.neededBy)}
              detail={`${qty(c.quantityFilled)} / ${qty(c.quantity)} ${unit}`}
              value={tr(`requirements.status.${c.status}`, { defaultValue: c.status })}
              onPress={() => router.push({ pathname: '/requirements/[id]', params: { id: c.id } })}
            />
          ))}
        </ListGroup>
      </View>
    ) : null;

  if (size !== 'compact') {
    return (
      <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start', paddingTop: 4 }}>
        <View style={{ flex: 1, gap: 8 }}>
          {summary}
          {upcoming}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          {matches}
          {instances}
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      {summary}
      {upcoming}
      {matches}
      {instances}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%', paddingRight: 12, paddingBottom: 10, gap: 2 }}>
      <Text variant="micro" tone="tertiary" style={{ textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text variant="callout">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
});
