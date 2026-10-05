import { StyleSheet, View } from 'react-native';
import i18n from '../../i18n';
import { useTheme } from '../../theme/theme';
import { Icon, type IconName } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'brand';

/** Inline, persistent message (offline, account under review, payment pending). */
export function Banner({
  tone = 'info',
  title,
  message,
  icon,
  action,
  onDismiss,
}: {
  tone?: BannerTone;
  title?: string;
  message: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
}) {
  const t = useTheme();
  const c = {
    info: { bg: t.colors.infoTint, fg: t.colors.info, icon: 'info' as IconName },
    success: { bg: t.colors.successTint, fg: t.colors.success, icon: 'checkCircle' as IconName },
    warning: { bg: t.colors.warningTint, fg: t.colors.warning, icon: 'warning' as IconName },
    danger: { bg: t.colors.dangerTint, fg: t.colors.danger, icon: 'error' as IconName },
    brand: { bg: t.colors.primaryTint, fg: t.colors.primary, icon: 'leaf' as IconName },
  }[tone];
  return (
    <View
      accessibilityRole="summary"
      style={[styles.banner, { backgroundColor: c.bg, borderRadius: t.radius.md }]}
    >
      <Icon name={icon ?? c.icon} size={20} color={c.fg} weight="fill" />
      <View style={{ flex: 1, gap: 2 }}>
        {title && (
          <Text variant="calloutStrong" style={{ color: c.fg }}>
            {title}
          </Text>
        )}
        <Text variant="callout" tone="secondary">
          {message}
        </Text>
        {action && (
          <Pressable
            onPress={action.onPress}
            accessibilityLabel={action.label}
            style={{ marginTop: 6 }}
            focusRadius={6}
          >
            <Text variant="calloutStrong" style={{ color: c.fg }}>
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          accessibilityLabel={i18n.t('common.dismiss')}
          hitSlop={10}
          focusRadius={8}
        >
          <Icon name="close" size={18} color={t.colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
});
