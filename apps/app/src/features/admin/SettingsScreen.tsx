import { DELIVERY_WINDOW_PATTERN, SettingsDto } from '@farmgo/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { dateShort, kes, timeAgo } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card, Divider, Segmented, Stepper, Switch } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { useDialog } from '../../ui/overlays/Dialog';
import { Sheet } from '../../ui/overlays/Sheet';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { type Column, DataTable } from './DataTable';
import {
  type AuditRow,
  type JobName,
  RUNNABLE_JOBS,
  type Settings,
  useAdminMutations,
  useAuditLog,
  useSettings,
} from './data';
import { AdminPage, MoneyField, Section } from './ui';

type Tab = 'business' | 'jobs' | 'audit';

/** APP_SPEC screen 61: business settings, scheduled jobs, audit log. */
export function SettingsScreen() {
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<Tab>('business');
  return (
    <AdminPage
      title={tr('admin.settings.title')}
      subtitle={tr('admin.settings.subtitle')}
      back
      scroll={tab !== 'audit'}
    >
      <View style={{ paddingBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'business', label: tr('admin.settings.tabs.business') },
            { value: 'jobs', label: tr('admin.settings.tabs.jobs') },
            { value: 'audit', label: tr('admin.settings.tabs.audit') },
          ]}
        />
      </View>
      {tab === 'business' && <BusinessSettings />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'audit' && <AuditTable />}
    </AdminPage>
  );
}

const NUMBER_KEYS = [
  'commissionBps',
  'deliveryFeeCents',
  'matchRadiusKm',
  'matchExpiryHours',
  'disputeWindowHours',
  'crateDepositCents',
  'crateReturnDays',
  'stkCheckDelaySeconds',
  'recurringHorizonDays',
] as const satisfies readonly (keyof Settings)[];
type NumberKey = (typeof NUMBER_KEYS)[number];
const MONEY_KEYS: readonly NumberKey[] = ['deliveryFeeCents', 'crateDepositCents'];
const WEIGHT_KEYS = ['distance', 'price', 'reliability', 'freshness', 'inclusion'] as const;

function BusinessSettings() {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const settings = useSettings();
  if (settings.isLoading) {
    return (
      <View style={{ gap: 12 }} accessibilityRole="progressbar">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={160} radius={14} />
        ))}
      </View>
    );
  }
  if (settings.error || !settings.data)
    return <ErrorState message={humanError(settings.error)} onRetry={() => settings.refetch()} />;
  const s = settings.data;
  const cols = size === 'expanded' ? 2 : 1;
  const groups: { title: string; keys: NumberKey[] }[] = [
    {
      title: tr('admin.settings.groups.money'),
      keys: ['commissionBps', 'deliveryFeeCents', 'crateDepositCents'],
    },
    {
      title: tr('admin.settings.groups.matching'),
      keys: ['matchRadiusKm', 'matchExpiryHours', 'recurringHorizonDays'],
    },
    {
      title: tr('admin.settings.groups.operations'),
      keys: ['disputeWindowHours', 'crateReturnDays', 'stkCheckDelaySeconds'],
    },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
      {groups.map((g) => (
        <View key={g.title} style={{ width: `${100 / cols}%`, padding: 6 }}>
          <Section title={g.title}>
            {g.keys.map((k) => (
              <SettingField key={k} name={k} value={s[k]} />
            ))}
          </Section>
        </View>
      ))}
      <View style={{ width: `${100 / cols}%`, padding: 6 }}>
        <Section title={tr('admin.settings.groups.delivery')}>
          <CutoffHourField value={s.nextDayCutoffHour} />
          <DeliveryWindowsField value={s.deliveryWindows} />
        </Section>
      </View>
      <View style={{ width: `${100 / cols}%`, padding: 6 }}>
        <Section title={tr('admin.settings.groups.invoices')}>
          <PrefinanceSwitch value={s.prefinanceInvoiceOrders} />
        </Section>
      </View>
      <View style={{ width: '100%', padding: 6 }}>
        <Section title={tr('admin.settings.fields.matchWeights')}>
          <Text variant="callout" tone="secondary">
            {tr('admin.settings.fields.matchWeightsHint')}
          </Text>
          <WeightsForm value={s.matchWeights} />
        </Section>
      </View>
    </View>
  );
}

function useSaveSetting() {
  const { t: tr } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const { saveSetting } = useAdminMutations();
  return {
    pending: saveSetting.isPending ? saveSetting.variables?.key : undefined,
    async save(key: keyof Settings, value: unknown, display: string) {
      const ok = await dialog.confirm({
        title: tr('admin.settings.saveConfirm', {
          setting: tr(`admin.settings.fields.${key}`),
          value: display,
        }),
        message: tr('admin.settings.saveBody'),
        confirmLabel: tr('common.save'),
        icon: 'settings',
      });
      if (!ok) return false;
      try {
        await saveSetting.mutateAsync({ key, value });
        toast.success(tr('admin.settings.saved', { setting: tr(`admin.settings.fields.${key}`) }));
        return true;
      } catch (err) {
        toast.error(humanError(err));
        return false;
      }
    },
  };
}

function SettingField({ name, value }: { name: NumberKey; value: number }) {
  const { t: tr } = useTranslation();
  const money = MONEY_KEYS.includes(name);
  const [cents, setCents] = useState<number | null>(value);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const { save, pending } = useSaveSetting();
  useEffect(() => {
    setCents(value);
    setText(String(value));
  }, [value]);

  const next = money ? cents : Number(text);
  const dirty = next !== value;
  const shape = SettingsDto.shape[name];

  const submit = async () => {
    const parsed = shape.safeParse(next);
    if (!parsed.success) {
      setError(tr('admin.settings.invalid'));
      return;
    }
    setError(null);
    const display = money
      ? kes(parsed.data)
      : name === 'commissionBps'
        ? `${parsed.data / 100}%`
        : String(parsed.data);
    const ok = await save(name, parsed.data, display);
    if (!ok) {
      setCents(value);
      setText(String(value));
    }
  };

  return (
    <View style={{ gap: 8 }}>
      {money ? (
        <MoneyField
          key={`m-${value}`}
          label={tr(`admin.settings.fields.${name}`)}
          cents={cents}
          onChangeCents={setCents}
          hint={tr(`admin.settings.fields.${name}Hint`)}
          error={error}
        />
      ) : (
        <TextField
          label={tr(`admin.settings.fields.${name}`)}
          value={text}
          onChangeText={(v) => setText(v.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
          hint={tr(`admin.settings.fields.${name}Hint`)}
          error={error}
          suffix={
            name === 'commissionBps' ? (
              <Text variant="callout" tone="secondary" numeric>
                {tr('admin.settings.percent', { value: (Number(text) || 0) / 100 })}
              </Text>
            ) : undefined
          }
        />
      )}
      {dirty && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={tr('common.save')}
            size="sm"
            fullWidth={false}
            onPress={submit}
            loading={pending === name}
          />
          <Button
            label={tr('common.cancel')}
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => {
              setCents(value);
              setText(String(value));
              setError(null);
            }}
          />
        </View>
      )}
    </View>
  );
}

/** Hour of day (Nairobi) before which an order can still be delivered tomorrow. */
function CutoffHourField({ value }: { value: number }) {
  const { t: tr } = useTranslation();
  const { save, pending } = useSaveSetting();
  const [hour, setHour] = useState(value);
  useEffect(() => setHour(value), [value]);
  const dirty = hour !== value;
  const label = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="calloutStrong">{tr('admin.settings.fields.nextDayCutoffHour')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Stepper
          value={hour}
          onChange={setHour}
          min={0}
          max={23}
          step={1}
          size="md"
          label={tr('admin.settings.fields.nextDayCutoffHour')}
        />
        <Text variant="bodyStrong" numeric>
          {label(hour)}
        </Text>
      </View>
      <Text variant="caption" tone="tertiary">
        {tr('admin.settings.fields.nextDayCutoffHourHint')}
      </Text>
      {dirty && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={tr('common.save')}
            size="sm"
            fullWidth={false}
            loading={pending === 'nextDayCutoffHour'}
            onPress={async () => {
              const ok = await save('nextDayCutoffHour', hour, label(hour));
              if (!ok) setHour(value);
            }}
          />
          <Button
            label={tr('common.cancel')}
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => setHour(value)}
          />
        </View>
      )}
    </View>
  );
}

/** Delivery windows buyers can choose: chips with remove, plus an add field validated as HH:MM-HH:MM. */
function DeliveryWindowsField({ value }: { value: string[] }) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const { save, pending } = useSaveSetting();
  const [windows, setWindows] = useState(value);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setWindows(value), [value]);
  const dirty = windows.join('|') !== value.join('|');

  const add = () => {
    const w = draft.trim();
    if (!DELIVERY_WINDOW_PATTERN.test(w)) return setError(tr('admin.settings.fields.deliveryWindowsInvalid'));
    if (windows.includes(w)) return setError(tr('admin.settings.fields.deliveryWindowsDuplicate'));
    setError(null);
    setWindows([...windows, w].sort());
    setDraft('');
  };

  const submit = async () => {
    const parsed = SettingsDto.shape.deliveryWindows.safeParse(windows);
    if (!parsed.success) return setError(tr('admin.settings.fields.deliveryWindowsInvalid'));
    setError(null);
    const ok = await save('deliveryWindows', parsed.data, parsed.data.join(', '));
    if (!ok) setWindows(value);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text variant="calloutStrong">{tr('admin.settings.fields.deliveryWindows')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {windows.map((w) => (
          <Pressable
            key={w}
            onPress={() => setWindows(windows.filter((x) => x !== w))}
            accessibilityLabel={tr('admin.settings.fields.removeWindow', { window: w })}
            focusRadius={999}
            haptics="selection"
            style={({ hovered, pressed }) => [
              styles.windowChip,
              {
                borderColor: t.colors.lineStrong,
                backgroundColor: hovered || pressed ? t.colors.dangerTint : t.colors.surface,
              },
            ]}
          >
            <Text variant="calloutStrong" numeric>
              {w}
            </Text>
            <Icon name="close" size={14} color={t.colors.textTertiary} />
          </Pressable>
        ))}
        {windows.length === 0 && (
          <Text variant="caption" tone="danger">
            {tr('admin.settings.fields.deliveryWindowsNone')}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <TextField
          containerStyle={{ flex: 1 }}
          placeholder="06:00-08:00"
          value={draft}
          onChangeText={(v) => setDraft(v.replace(/[^\d:-]/g, ''))}
          onSubmitEditing={add}
          returnKeyType="done"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          error={error}
          hint={tr('admin.settings.fields.deliveryWindowsHint')}
          accessibilityLabel={tr('admin.settings.fields.addWindow')}
        />
        <Button
          label={tr('admin.settings.fields.addWindow')}
          icon="plus"
          size="md"
          variant="secondary"
          fullWidth={false}
          onPress={add}
          disabled={!draft.trim()}
        />
      </View>
      {dirty && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={tr('common.save')}
            size="sm"
            fullWidth={false}
            onPress={submit}
            loading={pending === 'deliveryWindows'}
            disabled={windows.length === 0}
          />
          <Button
            label={tr('common.cancel')}
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => {
              setWindows(value);
              setDraft('');
              setError(null);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  windowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
});

function PrefinanceSwitch({ value }: { value: boolean }) {
  const { t: tr } = useTranslation();
  const { save } = useSaveSetting();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Switch
      value={v}
      onChange={async (next) => {
        setV(next);
        const ok = await save('prefinanceInvoiceOrders', next, next ? tr('common.yes') : tr('common.no'));
        if (!ok) setV(value);
      }}
      label={tr('admin.settings.fields.prefinanceInvoiceOrders')}
      description={tr('admin.settings.fields.prefinanceInvoiceOrdersHint')}
    />
  );
}

function WeightsForm({ value }: { value: Settings['matchWeights'] }) {
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const { save, pending } = useSaveSetting();
  const [w, setW] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => setW(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(Math.round(value[k] * 100))]))),
    [value],
  );
  const nums = Object.fromEntries(
    WEIGHT_KEYS.map((k) => [k, (Number(w[k]) || 0) / 100]),
  ) as Settings['matchWeights'];
  const sum = WEIGHT_KEYS.reduce((a, k) => a + nums[k], 0);
  const dirty = WEIGHT_KEYS.some((k) => Math.abs(nums[k] - value[k]) > 1e-9);

  const submit = async () => {
    const parsed = SettingsDto.shape.matchWeights.safeParse(nums);
    if (!parsed.success || Math.abs(sum - 1) > 0.001) {
      setError(tr('admin.settings.fields.weightsSum', { sum: Math.round(sum * 100) }));
      return;
    }
    setError(null);
    await save(
      'matchWeights',
      parsed.data,
      WEIGHT_KEYS.map((k) => `${tr(`admin.settings.fields.weight_${k}`)} ${Math.round(nums[k] * 100)}%`).join(
        ', ',
      ),
    );
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: size === 'compact' ? 'column' : 'row', gap: 10 }}>
        {WEIGHT_KEYS.map((k) => (
          <TextField
            key={k}
            containerStyle={{ flex: 1 }}
            label={tr(`admin.settings.fields.weight_${k}`)}
            value={w[k] ?? ''}
            onChangeText={(v) => setW((cur) => ({ ...cur, [k]: v.replace(/\D/g, '').slice(0, 3) }))}
            keyboardType="number-pad"
            suffix={
              <Text variant="callout" tone="secondary">
                %
              </Text>
            }
          />
        ))}
      </View>
      <Text
        variant="caption"
        tone={Math.abs(sum - 1) > 0.001 ? 'danger' : 'tertiary'}
        numeric
        accessibilityLiveRegion="polite"
      >
        {error ?? tr('admin.settings.fields.weightsTotal', { sum: Math.round(sum * 100) })}
      </Text>
      {dirty && (
        <Button
          label={tr('common.save')}
          size="sm"
          fullWidth={false}
          onPress={submit}
          loading={pending === 'matchWeights'}
        />
      )}
    </View>
  );
}

function Jobs() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const { runJob } = useAdminMutations();
  const [names, setNames] = useState<readonly string[]>(RUNNABLE_JOBS);

  const run = async (name: JobName) => {
    const label = tr(`admin.settings.jobs.${name}.name`, { defaultValue: name });
    const ok = await dialog.confirm({
      title: tr('admin.settings.runConfirm', { job: label }),
      message: tr('admin.settings.runBody'),
      confirmLabel: tr('admin.settings.runNow'),
      icon: 'timer',
    });
    if (!ok) return;
    try {
      const res = await runJob.mutateAsync({ name });
      if (res.available?.length) setNames(res.available);
      toast.success(tr('admin.settings.queued', { job: label }));
    } catch (err) {
      toast.error(humanError(err));
    }
  };

  const cols = size === 'expanded' ? 2 : 1;
  return (
    <View style={{ gap: 12 }}>
      <Text variant="callout" tone="secondary">
        {tr('admin.settings.jobsBody')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
        {names.map((name) => (
          <View key={name} style={{ width: `${100 / cols}%`, padding: 6 }}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.colors.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="micro" tone="brand">
                  {tr(`admin.settings.jobs.${name}.when`, { defaultValue: '' })}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">
                  {tr(`admin.settings.jobs.${name}.name`, { defaultValue: name })}
                </Text>
                <Text variant="caption" tone="secondary">
                  {tr(`admin.settings.jobs.${name}.desc`, { defaultValue: '' })}
                </Text>
              </View>
              <Button
                label={tr('admin.settings.runNow')}
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={() => run(name as JobName)}
                loading={runJob.isPending && runJob.variables?.name === name}
              />
            </Card>
          </View>
        ))}
      </View>
    </View>
  );
}

const ENTITIES = [
  '',
  'Order',
  'User',
  'Organization',
  'FarmerProfile',
  'Produce',
  'Match',
  'Dispute',
  'Payout',
  'PlatformSetting',
  'Crate',
  'Job',
];

function AuditTable() {
  const { t: tr } = useTranslation();
  const t = useTheme();
  const [entity, setEntity] = useState('');
  const [entityId, setEntityId] = useState('');
  const [open, setOpen] = useState<AuditRow | null>(null);
  const query = useAuditLog({ entity: entity || undefined, entityId: entityId.trim() || undefined });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<AuditRow>[] = [
    {
      key: 'when',
      title: tr('admin.settings.audit.col.when'),
      width: 120,
      sort: (r) => r.createdAt,
      render: (r) => (
        <Text variant="callout" numeric>
          {timeAgo(r.createdAt)}
        </Text>
      ),
    },
    {
      key: 'action',
      title: tr('admin.settings.audit.col.action'),
      flex: 2,
      primary: true,
      sort: (r) => r.action,
      render: (r) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {r.action}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {r.entity} · {r.entityId}
          </Text>
        </View>
      ),
    },
    {
      key: 'actor',
      title: tr('admin.settings.audit.col.actor'),
      flex: 1.2,
      hideBelow: 'expanded',
      render: (r) => (
        <Text variant="callout" numberOfLines={1} numeric>
          {r.actorId ?? tr('admin.settings.audit.system')}
        </Text>
      ),
    },
    {
      key: 'ip',
      title: 'IP',
      width: 130,
      hideBelow: 'expanded',
      render: (r) => (
        <Text variant="callout" tone="secondary" numeric>
          {r.ip ?? ''}
        </Text>
      ),
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        keyOf={(r) => r.id}
        onRowPress={setOpen}
        rowLabel={(r) => `${r.action} ${r.entity}`}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => query.refetch()}
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
        empty={{
          art: 'noResults',
          title: tr('admin.settings.audit.empty'),
          body: tr('admin.settings.audit.emptyBody'),
        }}
        contentPadding={0}
        header={
          <View style={{ gap: 10, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {ENTITIES.map((e) => (
                <View key={e || 'all'}>
                  <Button
                    label={e || tr('admin.common.all')}
                    size="sm"
                    variant={entity === e ? 'primary' : 'outline'}
                    fullWidth={false}
                    onPress={() => setEntity(e)}
                  />
                </View>
              ))}
            </View>
            <TextField
              placeholder={tr('admin.settings.audit.entityPlaceholder')}
              value={entityId}
              onChangeText={setEntityId}
              autoCapitalize="none"
              icon="search"
            />
          </View>
        }
      />
      <Sheet
        visible={!!open}
        onClose={() => setOpen(null)}
        title={open?.action}
        subtitle={open ? `${open.entity} · ${open.entityId}` : undefined}
        maxWidth={640}
      >
        {open && (
          <>
            <Text variant="caption" tone="secondary" numeric>
              {dateShort(open.createdAt)} · {open.actorId ?? tr('admin.settings.audit.system')}
              {open.ip ? ` · ${open.ip}` : ''}
            </Text>
            <Divider />
            {(['before', 'after'] as const).map((k) => (
              <View key={k} style={{ gap: 6 }}>
                <Text variant="calloutStrong">{tr(`admin.settings.audit.${k}`)}</Text>
                <View
                  style={{ backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.sm, padding: 12 }}
                >
                  <Text variant="caption" numeric style={{ fontFamily: undefined }} selectable>
                    {open[k] === null || open[k] === undefined
                      ? tr('admin.common.none')
                      : JSON.stringify(open[k], null, 2)}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </Sheet>
    </>
  );
}
