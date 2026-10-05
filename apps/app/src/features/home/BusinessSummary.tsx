import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { humanError } from '../../lib/errors';
import { kes } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { Pressable } from '../../ui/Pressable';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { useBuyerDashboard } from '../buyer/data';

/** Profile: the buyer's order count and spend this month, quiet and on the page surface. */
export function BuyerStatsCard() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const stats = useBuyerDashboard();
  const tiles = [
    {
      key: 'orders',
      label: tr('home.totalOrders'),
      value: stats.data ? String(stats.data.totalOrders) : null,
      onPress: () => router.navigate('/orders'),
    },
    { key: 'spend', label: tr('home.monthSpend'), value: stats.data ? kes(stats.data.thisMonthSpend) : null },
  ];
  if (stats.error) {
    return <ErrorState compact message={humanError(stats.error)} onRetry={() => stats.refetch()} />;
  }
  return (
    <View style={styles.stats}>
      {tiles.map((s) => (
        <Pressable
          key={s.key}
          onPress={s.onPress}
          disabled={!s.onPress}
          accessibilityRole={s.onPress ? 'button' : 'summary'}
          accessibilityLabel={`${s.label}, ${s.value ?? tr('common.loading')}`}
          focusRadius={t.radius.md}
          style={({ pressed, hovered }) => [
            styles.stat,
            {
              backgroundColor: (pressed || hovered) && s.onPress ? t.colors.surfaceMuted : t.colors.surface,
              borderColor: t.colors.line,
              borderRadius: t.radius.md,
            },
          ]}
        >
          <Text variant="caption" tone="secondary">
            {s.label}
          </Text>
          {s.value === null ? (
            <Skeleton width={80} height={24} style={{ marginTop: 4 }} />
          ) : (
            <Text
              variant={s.value.length > 9 ? 'title3' : 'statNumber'}
              numeric
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {s.value}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, padding: 14, gap: 2, borderWidth: 1 },
});
