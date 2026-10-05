import type { CrateDetailDto, CrateDto } from '@farmgo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { CrateScanner } from '../../../features/driver/CrateScanner';
import { ApiError, api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { kes, timeAgo } from '../../../lib/format';
import { useSizeClass, useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Card, Chip, Divider, Pill, type Tone } from '../../../ui/Controls';
import { Icon, type IconName } from '../../../ui/Icon';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { Header, Screen } from '../../../ui/Screen';
import { Skeleton } from '../../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

type CrateStatus = CrateDto['status'];

const STATUS: Record<CrateStatus, { tone: Tone; icon: IconName }> = {
  IN_STOCK: { tone: 'success', icon: 'storefront' },
  WITH_FARMER: { tone: 'brand', icon: 'farm' },
  IN_TRANSIT: { tone: 'info', icon: 'truck' },
  WITH_BUYER: { tone: 'warning', icon: 'building' },
  LOST: { tone: 'danger', icon: 'warning' },
  RETIRED: { tone: 'neutral', icon: 'close' },
};

// Mirrors the server's crate rules so buttons only show when the move is allowed.
const CAN_RETURN: CrateStatus[] = ['WITH_BUYER', 'IN_TRANSIT', 'WITH_FARMER', 'LOST'];
const CAN_LOSE: CrateStatus[] = ['IN_STOCK', 'WITH_FARMER', 'IN_TRANSIT', 'WITH_BUYER'];

/** Crate lookup: scan or type a code to see where a crate is and record a return or loss. */
export default function ScreenScan() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const dialog = useDialog();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  const crate = useQuery({
    queryKey: ['crate', code],
    enabled: !!code,
    queryFn: () => api.get<CrateDetailDto>(`/v1/crates/${encodeURIComponent(code!)}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  const scan = useMutation({
    mutationFn: (action: 'RETURN' | 'MARK_LOST') =>
      api.post<CrateDto>('/v1/crates/scan', { qrCode: code, action }),
    onSuccess: (_, action) => {
      void qc.invalidateQueries({ queryKey: ['crate', code] });
      toast.success(tr(action === 'RETURN' ? 'driver.crateReturned' : 'driver.crateLost'));
    },
    onError: (e) => toast.error(humanError(e)),
  });

  const lookup = (c: string) => {
    setCode(c);
    setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 6));
  };

  const act = async (action: 'RETURN' | 'MARK_LOST') => {
    const lost = action === 'MARK_LOST';
    const ok = await dialog.confirm({
      title: tr(lost ? 'driver.loseTitle' : 'driver.returnTitle', { code }),
      message: tr(lost ? 'driver.loseBody' : 'driver.returnBody'),
      confirmLabel: tr(lost ? 'driver.markLost' : 'driver.markReturned'),
      destructive: lost,
      icon: lost ? 'warning' : 'crate',
    });
    if (ok) scan.mutate(action);
  };

  const notFound = crate.error instanceof ApiError && crate.error.status === 404;
  const c = crate.data;
  const wide = size !== 'compact';

  const result = !code ? (
    <EmptyState
      compact
      art="noResults"
      title={tr('driver.scanPromptTitle')}
      body={tr('driver.scanPromptBody')}
    />
  ) : crate.isLoading ? (
    <View style={{ gap: 12 }}>
      <Skeleton height={140} radius={14} />
      <Skeleton height={220} radius={14} />
    </View>
  ) : notFound ? (
    <EmptyState
      compact
      art="noResults"
      title={tr('driver.crateNotFound', { code })}
      body={tr('driver.crateNotFoundBody')}
    />
  ) : crate.error ? (
    <ErrorState compact onRetry={() => void crate.refetch()} message={humanError(crate.error)} />
  ) : c ? (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <View style={styles.row}>
          <View
            style={[styles.crateIcon, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.sm }]}
          >
            <Icon name="crate" size={28} color={t.colors.primary} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="title2" numeric>
              {c.qrCode}
            </Text>
            <Text variant="caption" tone="secondary">
              {[c.size, c.depositCents ? tr('driver.deposit', { amount: kes(c.depositCents) }) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <Pill
            label={tr(`driver.crateStatus.${c.status}`)}
            tone={STATUS[c.status].tone}
            icon={STATUS[c.status].icon}
          />
          {c.lastSeenAt && (
            <Text variant="caption" tone="tertiary">
              {tr('driver.lastSeen', { when: timeAgo(c.lastSeenAt) })}
            </Text>
          )}
        </View>
        {(CAN_RETURN.includes(c.status) || CAN_LOSE.includes(c.status)) && (
          <View style={styles.actions}>
            {CAN_RETURN.includes(c.status) && (
              <Button
                label={tr('driver.markReturned')}
                icon="repeat"
                style={{ flex: 1 }}
                loading={scan.isPending && scan.variables === 'RETURN'}
                onPress={() => void act('RETURN')}
              />
            )}
            {CAN_LOSE.includes(c.status) && (
              <Button
                label={tr('driver.markLost')}
                variant="outline"
                icon="warning"
                style={{ flex: 1 }}
                loading={scan.isPending && scan.variables === 'MARK_LOST'}
                onPress={() => void act('MARK_LOST')}
              />
            )}
          </View>
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text variant="headline">{tr('driver.movements')}</Text>
        {c.movements.length === 0 ? (
          <Text variant="callout" tone="tertiary">
            {tr('driver.noMovements')}
          </Text>
        ) : (
          c.movements.slice(0, 12).map((m, i) => (
            <View key={m.id} style={{ gap: 12 }}>
              {i > 0 && <Divider />}
              <View style={styles.row}>
                <Icon name={STATUS[m.to].icon} size={18} color={t.colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text variant="calloutStrong">
                    {tr(`driver.crateStatus.${m.from}`)} → {tr(`driver.crateStatus.${m.to}`)}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {[m.scannedBy.name, timeAgo(m.createdAt), m.note].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  ) : null;

  return (
    <Screen
      header={
        <Header title={tr('driver.scanTitle')} subtitle={tr('driver.scanSubtitle')} back={false} large />
      }
      refreshing={crate.isRefetching}
      onRefresh={code ? () => void crate.refetch() : undefined}
    >
      <View style={[{ gap: 20 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={[{ gap: 16 }, wide && { width: 400 }]}>
          <CrateScanner onCode={lookup} busy={crate.isFetching} />
          {recent.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text variant="caption" tone="secondary">
                {tr('driver.recentScans')}
              </Text>
              <View style={styles.chips}>
                {recent.map((r) => (
                  <Chip key={r} label={r} icon="crate" selected={r === code} onPress={() => setCode(r)} />
                ))}
              </View>
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>{result}</View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  crateIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
