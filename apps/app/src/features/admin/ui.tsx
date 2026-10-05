import { router } from 'expo-router';
import { Children, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { kes, parseKes } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Card, Pill, type Tone } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Banner } from '../../ui/overlays/Banner';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen, type ScreenProps } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { TextField, type TextFieldProps } from '../../ui/TextField';

/**
 * Page frame shared by every admin screen: large title on top-level tabs, compact header
 * with back on detail screens, actions to the right on wide windows and under the title on phones.
 */
export function AdminPage({
  title,
  subtitle,
  actions,
  back = false,
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  maxWidth,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: boolean;
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  const size = useSizeClass();
  const compact = size === 'compact';
  const header = (
    <View>
      <Header
        title={title}
        subtitle={compact ? subtitle : undefined}
        back={back}
        large={!back}
        right={!compact ? actions : undefined}
      />
      {!back && !compact && subtitle && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, marginTop: -4 }}>
          <Text variant="callout" tone="secondary">
            {subtitle}
          </Text>
        </View>
      )}
      {compact && actions && <View style={styles.compactActions}>{actions}</View>}
    </View>
  );
  const props: Partial<ScreenProps> = { scroll, refreshing, onRefresh, footer, maxWidth };
  return (
    <Screen header={header} padded={scroll} {...props}>
      {children}
    </Screen>
  );
}

/** Wide layouts: children side by side; phones: stacked. */
export function Columns({
  children,
  ratio = [1, 1],
  gap = 16,
}: {
  children: ReactNode[];
  ratio?: number[];
  gap?: number;
}) {
  const size = useSizeClass();
  if (size === 'compact') return <View style={{ gap }}>{children}</View>;
  return (
    <View style={{ flexDirection: 'row', gap, alignItems: 'flex-start' }}>
      {Children.map(children, (c, i) => (
        <View style={{ flex: ratio[i] ?? 1, minWidth: 0 }}>{c}</View>
      ))}
    </View>
  );
}

/** Responsive grid of equal cards (stats). */
export function StatGrid({ children, min = 3 }: { children: ReactNode[]; min?: number }) {
  const size = useSizeClass();
  const cols = size === 'expanded' ? Math.max(min, 4) : size === 'medium' ? min : 2;
  return (
    <View style={styles.grid}>
      {Children.map(children, (c) => (
        <View style={{ width: `${100 / cols}%`, padding: 6 }}>{c}</View>
      ))}
    </View>
  );
}

/** Mockup stat card: label, big number, optional hint and chevron when it leads somewhere. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  onPress,
  loading,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  icon?: IconName;
  tone?: Tone;
  onPress?: () => void;
  loading?: boolean;
}) {
  const t = useTheme();
  const accent: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: t.colors.surfaceMuted, fg: t.colors.textSecondary },
    brand: { bg: t.colors.primaryTint, fg: t.colors.primary },
    success: { bg: t.colors.successTint, fg: t.colors.success },
    warning: { bg: t.colors.warningTint, fg: t.colors.warning },
    danger: { bg: t.colors.dangerTint, fg: t.colors.danger },
    info: { bg: t.colors.infoTint, fg: t.colors.info },
  };
  const a = accent[tone];
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${label}, ${value ?? ''}`}
      style={{ gap: 10, minHeight: 112 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {icon && (
          <View style={[styles.statIcon, { backgroundColor: a.bg }]}>
            <Icon name={icon} size={16} color={a.fg} weight="fill" />
          </View>
        )}
      </View>
      {loading || value === null || value === undefined ? (
        <Skeleton width={90} height={28} />
      ) : (
        <Text variant="statNumber" numeric numberOfLines={1}>
          {typeof value === 'number' ? value.toLocaleString('en-KE') : value}
        </Text>
      )}
      {(hint || onPress) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="caption" tone={onPress ? 'brand' : 'tertiary'} numberOfLines={1} style={{ flex: 1 }}>
            {hint ?? ''}
          </Text>
          {onPress && <Icon name="chevronRight" size={14} color={t.colors.primary} />}
        </View>
      )}
    </Card>
  );
}

/** Titled card section. */
export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: object;
}) {
  return (
    <Card style={[{ gap: 14 }, style]}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          {title && (
            <Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </Text>
          )}
          {action}
        </View>
      )}
      {children}
    </Card>
  );
}

/** Label / value pairs, two per row on wide screens. */
export function Facts({
  rows,
  columns = 2,
}: {
  rows: { label: string; value: ReactNode; numeric?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  const size = useSizeClass();
  const cols = size === 'compact' ? Math.min(columns, 2) : columns;
  return (
    <View style={styles.facts}>
      {rows.map((r) => (
        <View key={r.label} style={{ width: `${100 / cols}%`, paddingRight: 12, paddingBottom: 12, gap: 2 }}>
          <Text variant="micro" tone="tertiary" style={{ letterSpacing: 0.4 }}>
            {r.label.toUpperCase()}
          </Text>
          {typeof r.value === 'string' || typeof r.value === 'number' ? (
            <Text variant="body" numeric={r.numeric}>
              {r.value === '' ? ' ' : r.value}
            </Text>
          ) : (
            <View style={{ alignItems: 'flex-start' }}>{r.value}</View>
          )}
        </View>
      ))}
    </View>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  READY_FOR_QA: 'info',
  QA_PASSED: 'success',
  QA_REJECTED: 'danger',
  IN_TRANSIT: 'brand',
  DELIVERED: 'success',
  DISPUTED: 'danger',
  PAID: 'success',
  REFUNDED: 'neutral',
  CANCELLED: 'neutral',
  SUCCESS: 'success',
  FAILED: 'danger',
  TIMEOUT: 'danger',
  OPEN: 'warning',
  UNDER_REVIEW: 'info',
  RESOLVED_REFUND: 'success',
  RESOLVED_NO_REFUND: 'neutral',
  PLANNED: 'info',
  IN_PROGRESS: 'brand',
  COMPLETED: 'success',
  SUBMITTED: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
  IN_STOCK: 'success',
  WITH_FARMER: 'info',
  WITH_BUYER: 'warning',
  LOST: 'danger',
  RETIRED: 'neutral',
  UNPAID: 'warning',
  PARTIALLY_REFUNDED: 'warning',
  ARRIVED: 'info',
  SKIPPED: 'neutral',
  ACTIVE: 'success',
  BANNED: 'danger',
  INACTIVE: 'neutral',
  PREPAID: 'neutral',
  NET_7: 'info',
  NET_14: 'info',
  NET_30: 'info',
};

/** Status pill with translated label (text plus color, never color alone). */
export function StatusPill({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const { t: tr } = useTranslation();
  return (
    <Pill
      label={tr(`admin.status.${status}`, { defaultValue: status.replace(/_/g, ' ') })}
      tone={STATUS_TONE[status] ?? 'neutral'}
      size={size}
    />
  );
}

/** Money input: "KES" prefix, keeps cents in state. */
export function MoneyField({
  cents,
  onChangeCents,
  ...rest
}: { cents: number | null; onChangeCents: (v: number | null) => void } & Omit<
  TextFieldProps,
  'value' | 'onChangeText' | 'prefix'
>) {
  return (
    <TextField
      prefix="KES"
      keyboardType="decimal-pad"
      defaultValue={cents === null ? '' : kes(cents, { bare: true })}
      onChangeText={(v) => onChangeCents(v.trim() ? parseKes(v) : null)}
      {...rest}
    />
  );
}

/** Loading / error frame for detail screens. */
export function DetailState({
  loading,
  error,
  onRetry,
  notFound,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  notFound: string;
}) {
  if (loading) {
    return (
      <View style={{ gap: 12 }} accessibilityRole="progressbar">
        <Skeleton height={96} radius={14} />
        <Skeleton height={180} radius={14} />
        <Skeleton height={140} radius={14} />
      </View>
    );
  }
  const status = (error as { status?: number } | null)?.status;
  return <ErrorState message={status === 404 ? notFound : humanError(error)} onRetry={onRetry} />;
}

/** Inline mutation error. */
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner tone="danger" message={humanError(error)} />;
}

/** Small "Name  →" link row inside cards. */
export function LinkRow({
  label,
  hint,
  onPress,
  icon = 'chevronRight',
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  icon?: IconName;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      focusRadius={8}
      style={({ hovered, pressed }) => [
        styles.linkRow,
        { backgroundColor: hovered || pressed ? t.colors.surfaceMuted : 'transparent' },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {label}
        </Text>
        {hint && (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
      <Icon name={icon} size={16} color={t.colors.textTertiary} />
    </Pressable>
  );
}

export const goUser = (id: string) => router.push({ pathname: '/admin/users/[id]', params: { id } });
export const goOrg = (id: string) => router.push({ pathname: '/admin/orgs/[id]', params: { id } });
export const goDispute = (id: string) => router.push({ pathname: '/admin/disputes/[id]', params: { id } });
export const goRoute = (id: string) => router.push({ pathname: '/admin/routes/[id]', params: { id } });

const styles = StyleSheet.create({
  compactActions: { paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  facts: { flexDirection: 'row', flexWrap: 'wrap' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: 8,
  },
});
