import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { api } from '../../lib/api';
import { kes } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { palette } from '../../theme/tokens';
import { Card } from '../../ui/Controls';
import { Pressable } from '../../ui/Pressable';
import { Skeleton } from '../../ui/Skeleton';
import { Text } from '../../ui/Text';

interface Month {
  month: string; // YYYY-MM
  grossCents: number;
  commissionCents: number;
  netCents: number;
  orders: number;
}

/** GET /v1/earnings (B16): paid out per Nairobi calendar month, newest first. */
function useEarnings(as: 'farmer' | 'supplier', months = 6) {
  return useQuery({
    queryKey: ['earnings', as, months],
    queryFn: ({ signal }) =>
      api.get<{ months: Month[]; pendingCents: number }>('/v1/earnings', { months, as }, signal),
  });
}

const PLOT_H = 120;

/**
 * Net paid per month as bars (one series, one hue, no legend: the title names it). Tapping a
 * bar shows that month's gross, fee and orders; the latest month is labelled by default.
 */
export function EarningsChart({ as }: { as: 'farmer' | 'supplier' }) {
  const t = useTheme();
  const { t: tr, i18n } = useTranslation();
  const q = useEarnings(as);
  const months = [...(q.data?.months ?? [])].reverse(); // oldest to newest, left to right
  const [picked, setPicked] = useState<number | null>(null);
  const idx = picked ?? months.length - 1;
  const sel = months[idx];
  const max = Math.max(1, ...months.map((m) => m.netCents));
  const label = (ym: string) =>
    new Date(`${ym}-01T12:00:00`).toLocaleDateString(i18n.language === 'sw' ? 'sw-KE' : 'en-KE', {
      month: 'short',
    });

  const summary = months.map((m) => `${label(m.month)} ${kes(m.netCents)}`).join(', ');

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="headline" accessibilityRole="header">
          {tr('earnings.chartTitle')}
        </Text>
        {sel ? (
          <Text variant="caption" tone="secondary" numeric>
            {tr('earnings.chartDetail', {
              month: label(sel.month),
              net: kes(sel.netCents),
              gross: kes(sel.grossCents),
              fee: kes(sel.commissionCents),
              count: sel.orders,
            })}
          </Text>
        ) : null}
      </View>
      {q.isLoading ? (
        <Skeleton height={PLOT_H + 24} radius={10} />
      ) : months.length === 0 ? null : (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`${tr('earnings.chartTitle')}: ${summary}`}
        >
          <View style={[styles.plot, { height: PLOT_H, borderBottomColor: t.colors.lineStrong }]}>
            {months.map((m, i) => {
              const h = m.netCents > 0 ? Math.max(4, Math.round((m.netCents / max) * PLOT_H)) : 0;
              const active = i === idx;
              return (
                <Pressable
                  key={m.month}
                  onPress={() => setPicked(i)}
                  accessibilityLabel={`${label(m.month)}, ${kes(m.netCents)}`}
                  accessibilityState={{ selected: active }}
                  focusRadius={8}
                  hitSlop={{ top: PLOT_H, bottom: 8 }}
                  style={styles.col}
                >
                  <View
                    style={{
                      height: h,
                      width: '62%',
                      maxWidth: 36,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      // Same hue, two steps: the selected month darker, the rest a mid green that reads on white and dark.
                      backgroundColor: active
                        ? t.colors.primary
                        : palette.green[t.scheme === 'dark' ? 600 : 300],
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.axis}>
            {months.map((m, i) => (
              <Text
                key={m.month}
                variant="micro"
                tone={i === idx ? 'default' : 'tertiary'}
                align="center"
                style={{ flex: 1 }}
              >
                {label(m.month)}
              </Text>
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1 },
  col: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  axis: { flexDirection: 'row', gap: 2, marginTop: 6 },
});
