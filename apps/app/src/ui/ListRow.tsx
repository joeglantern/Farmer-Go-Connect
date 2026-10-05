import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Divider } from './Controls';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

/**
 * Settings-style row: tinted icon, label and optional detail, trailing value or chevron.
 * Group rows in <ListGroup> for the rounded card and hairline dividers.
 */
export function ListRow({
  icon,
  label,
  detail,
  value,
  onPress,
  trailing,
  badge,
  tone = 'default',
  external,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  badge?: number;
  tone?: 'default' | 'danger';
  external?: boolean;
}) {
  const t = useTheme();
  const danger = tone === 'danger';
  const body = (
    <>
      <View
        style={[
          styles.icon,
          { backgroundColor: danger ? t.colors.dangerTint : t.colors.primaryTint, borderRadius: 10 },
        ]}
      >
        <Icon name={icon} size={18} color={danger ? t.colors.danger : t.colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" tone={danger ? 'danger' : 'default'}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone="secondary" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {badge ? (
        <View style={[styles.badge, { backgroundColor: t.colors.primary }]}>
          <Text variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }} numeric>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
      {trailing ??
        (onPress ? (
          <Icon name={external ? 'share' : 'chevronRight'} size={18} color={t.colors.textTertiary} />
        ) : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={[label, detail, value, badge ? String(badge) : undefined]
        .filter(Boolean)
        .join(', ')}
      focusRadius={t.radius.md}
      style={({ pressed, hovered }) => [
        styles.row,
        { backgroundColor: pressed || hovered ? t.colors.surfaceMuted : 'transparent' },
      ]}
    >
      {body}
    </Pressable>
  );
}

export function ListGroup({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: string;
}) {
  const t = useTheme();
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text
          variant="micro"
          tone="secondary"
          style={{ paddingHorizontal: 4, textTransform: 'uppercase' }}
          accessibilityRole="header"
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.colors.line,
          overflow: 'hidden',
        }}
      >
        {rows.map((r, i) => (
          <View key={(r as { key?: string }).key ?? i}>
            {i > 0 && <Divider inset={60} />}
            {r}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="caption" tone="tertiary" style={{ paddingHorizontal: 4 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  icon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
