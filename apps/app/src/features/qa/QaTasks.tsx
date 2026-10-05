import type { QaTaskDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { dateShort, produceName, qty, relativeDay, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Card, Chip, Pill } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { callPhone, openDirections, useQaDashboard, useQaTasks } from './data';

/** QA officer home: orders waiting for a quality check in every county, soonest first. */
export function QaTasks() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const [scope, setScope] = useState<string>('all');
  const dash = useQaDashboard();
  const byCounty = dash.data?.tasksByCounty ?? [];
  const waiting = byCounty.reduce((s, c) => s + c.tasks, 0);
  // One call for every county; the chips filter it here.
  const tasks = useQaTasks('all');
  const list = useMemo(
    () =>
      (tasks.data ?? [])
        .filter((o) => scope === 'all' || o.items.some((i) => i.listing.farm.county === scope))
        .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
    [tasks.data, scope],
  );
  const columns = size === 'expanded' ? 3 : size === 'medium' ? 2 : 1;
  const passRate = dash.data?.passRateThisMonth;
  const loading = dash.isLoading || tasks.isLoading;
  const error = dash.error ?? tasks.error;
  const refresh = () => {
    void dash.refetch();
    void tasks.refetch();
  };

  return (
    <Screen
      header={<Header title={tr('qa.tasksTitle')} subtitle={tr('qa.tasksSubtitle')} back={false} large />}
      refreshing={dash.isRefetching || tasks.isRefetching}
      onRefresh={refresh}
    >
      <View style={{ gap: 16 }}>
        <View style={styles.row}>
          <Stat
            label={tr('qa.waiting')}
            value={dash.data ? String(waiting) : null}
            icon="basket"
            warn={waiting > 0}
          />
          <Stat
            label={tr('qa.inspectedToday')}
            value={dash.data ? String(dash.data.inspectedToday) : null}
            icon="checkCircle"
          />
          <Stat
            label={tr('qa.passRate')}
            value={dash.data ? (passRate == null ? '·' : `${Math.round(passRate)}%`) : null}
            icon="shield"
          />
        </View>
        {byCounty.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={{ marginHorizontal: -4 }}
          >
            <Chip
              label={tr('qa.allCounties')}
              icon="globe"
              selected={scope === 'all'}
              count={waiting}
              onPress={() => setScope('all')}
            />
            {byCounty.map((c) => (
              <Chip
                key={c.county}
                label={c.county}
                selected={scope === c.county}
                count={c.tasks}
                onPress={() => setScope(c.county)}
              />
            ))}
          </ScrollView>
        )}

        {loading ? (
          <SkeletonList count={3} height={200} />
        ) : error ? (
          <ErrorState onRetry={refresh} />
        ) : list.length === 0 ? (
          <EmptyState
            art="noListings"
            title={tr('qa.noTasksTitle')}
            body={scope === 'all' ? tr('qa.noTasksAllBody') : tr('qa.noTasksBody', { county: scope })}
            action={
              scope === 'all'
                ? { label: tr('driver.checkAgain'), onPress: refresh, icon: 'refresh' }
                : { label: tr('qa.allCounties'), onPress: () => setScope('all'), icon: 'globe' }
            }
          />
        ) : (
          <View style={styles.grid}>
            {list.map((task) => (
              <View
                key={task.id}
                style={{ width: columns === 1 ? '100%' : columns === 2 ? '48.8%' : '32.2%' }}
              >
                <TaskCard task={task} showCounty={scope === 'all'} />
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

export function Stat({
  label,
  value,
  icon,
  warn,
}: {
  label: string;
  value: string | null;
  icon: IconName;
  warn?: boolean;
}) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, gap: 6 }}>
      <View style={styles.statHead}>
        <Icon name={icon} size={18} color={warn ? t.colors.warning : t.colors.primary} weight="duotone" />
        <Text variant="caption" tone="secondary" numberOfLines={2} style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text
        variant="display"
        numeric
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ color: warn ? t.colors.warning : t.colors.text }}
      >
        {value ?? ' '}
      </Text>
    </Card>
  );
}

function TaskCard({ task, showCounty }: { task: QaTaskDto; showCounty: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const farm = task.items[0]?.listing.farm;
  const farmer = farm?.farmer.user;
  const done = task.items.filter((i) => i.inspection).length;
  const overdue = new Date(task.deliveryDate).getTime() < Date.now();
  const open = () =>
    router.push({
      pathname: '/qa/[orderId]',
      params: { orderId: task.id },
    });

  return (
    // The body opens the inspection; call, directions and Start sit beside it, not inside it
    // (a button may not contain a button).
    <Card style={{ gap: 14 }}>
      <Pressable
        onPress={open}
        accessibilityLabel={`${farm?.name ?? task.code}, ${task.items.length}`}
        focusRadius={t.radius.sm}
        style={{ gap: 14 }}
      >
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline" numberOfLines={1}>
              {farm?.name ?? task.code}
            </Text>
            <View style={styles.meta}>
              <Icon name="location" size={14} color={t.colors.primary} weight="fill" />
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {[farm?.ward, showCounty || !farm?.ward ? farm?.county : null].filter(Boolean).join(', ')}
              </Text>
            </View>
          </View>
          <Pill
            label={overdue ? tr('qa.overdue') : relativeDay(task.deliveryDate)}
            tone={overdue ? 'danger' : 'warning'}
            icon="clock"
            size="sm"
          />
        </View>
        <View style={{ gap: 8 }}>
          {task.items.map((it) => (
            <View key={it.id} style={styles.item}>
              <ProduceImage
                uri={it.listing.photoUrls[0] ?? it.listing.produce.imageUrl}
                category={it.listing.produce.category}
                produce={it.listing.produce}
                size={40}
                radius={10}
              />
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {produceName(it.listing.produce)}
              </Text>
              <Text variant="bodyStrong" numeric>
                {qty(it.quantity)} {unitLabel(it.listing.produce.unit, it.quantity)}
              </Text>
              {it.inspection && (
                <Icon
                  name="checkCircle"
                  size={18}
                  color={it.inspection.passed ? t.colors.success : t.colors.danger}
                  weight="fill"
                />
              )}
            </View>
          ))}
        </View>
        <Text variant="caption" tone="tertiary" numberOfLines={2}>
          {tr('qa.forBuyer', {
            buyer: task.buyerOrg.name,
            date: dateShort(task.deliveryDate),
            code: task.code,
          })}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <IconButton
          icon="phone"
          label={tr('qa.callFarmer', { name: farmer?.name ?? '' })}
          variant="tinted"
          onPress={() => callPhone(farmer?.phoneNumber)}
          disabled={!farmer?.phoneNumber}
        />
        <IconButton
          icon="navigate"
          label={tr('qa.directions')}
          variant="tinted"
          onPress={() => openDirections(farm?.lat, farm?.lng, farm?.name ?? '')}
        />
        <Button
          label={
            done > 0 ? tr('qa.continueInspection', { done, total: task.items.length }) : tr('qa.inspect')
          }
          size="md"
          icon="shield"
          style={{ flex: 1 }}
          onPress={open}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
