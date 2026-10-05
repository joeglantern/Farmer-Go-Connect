import type { InputProductListItemDto } from '@farmgo/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { CATEGORIES, CATEGORY_ICON, useLowStockIds, useMyProducts } from '../../features/supplier/data';
import { kes, qty, unitLabel } from '../../lib/format';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button, IconButton } from '../../ui/Button';
import { Card, Chip, Pill } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { ProduceImage } from '../../ui/Media';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { SearchField } from '../../ui/TextField';

const open = (id: string) => router.push({ pathname: '/products/[id]', params: { id } });

/** Supplier's product catalog: cards on phones, a table on wide screens. */
export default function Products() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const products = useMyProducts();
  const low = useLowStockIds(products.data);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<(typeof CATEGORIES)[number] | null>(null);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) => (!cat || p.category === cat) && (!n || p.name.toLowerCase().includes(n)),
    );
  }, [products.data, q, cat]);
  const used = CATEGORIES.filter((c) => products.data?.some((p) => p.category === c));
  const table = size === 'expanded';

  return (
    <Screen
      header={
        <Header
          title={tr('supplier.productsTitle')}
          subtitle={
            products.data
              ? tr('supplier.productsCount', { count: products.data.filter((p) => p.active).length })
              : undefined
          }
          right={
            size === 'compact' ? (
              <IconButton
                icon="plus"
                label={tr('supplier.addProduct')}
                variant="tinted"
                onPress={() => open('new')}
              />
            ) : (
              <Button
                label={tr('supplier.addProduct')}
                icon="plus"
                size="md"
                fullWidth={false}
                onPress={() => open('new')}
              />
            )
          }
        />
      }
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
    >
      {products.isLoading ? (
        <SkeletonList count={5} height={84} />
      ) : products.error ? (
        <ErrorState onRetry={() => void products.refetch()} />
      ) : (products.data?.length ?? 0) === 0 ? (
        <EmptyState
          art="noListings"
          title={tr('supplier.noProductsTitle')}
          body={tr('supplier.noProductsBody')}
          action={{ label: tr('supplier.addProduct'), onPress: () => open('new'), icon: 'plus' }}
        />
      ) : (
        <View style={{ gap: 16 }}>
          <SearchField value={q} onChangeText={setQ} placeholder={tr('supplier.searchProducts')} />
          {used.length > 1 && (
            <View style={styles.chips}>
              <Chip label={tr('supplier.allCategories')} selected={!cat} onPress={() => setCat(null)} />
              {used.map((c) => (
                <Chip
                  key={c}
                  label={tr(`supplier.category.${c}`)}
                  icon={CATEGORY_ICON[c]}
                  selected={cat === c}
                  onPress={() => setCat(c)}
                />
              ))}
            </View>
          )}
          {list.length === 0 ? (
            <EmptyState
              compact
              art="noResults"
              title={tr('supplier.noMatch')}
              action={{
                label: tr('agent.clearFilters'),
                onPress: () => {
                  setQ('');
                  setCat(null);
                },
                icon: 'close',
              }}
            />
          ) : table ? (
            <Card padded={false}>
              <View style={[styles.tr, { borderBottomWidth: 1, borderBottomColor: t.colors.line }]}>
                <Text variant="micro" tone="tertiary" style={{ flex: 3 }}>
                  {tr('supplier.col.product').toUpperCase()}
                </Text>
                <Text variant="micro" tone="tertiary" style={{ flex: 1.6 }}>
                  {tr('supplier.col.category').toUpperCase()}
                </Text>
                <Text variant="micro" tone="tertiary" style={{ flex: 1.3 }} align="right">
                  {tr('supplier.col.price').toUpperCase()}
                </Text>
                <Text variant="micro" tone="tertiary" style={{ flex: 1.3 }} align="right">
                  {tr('supplier.col.stock').toUpperCase()}
                </Text>
                <Text variant="micro" tone="tertiary" style={{ flex: 1.2 }} align="right">
                  {tr('supplier.col.county').toUpperCase()}
                </Text>
              </View>
              {list.map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => open(p.id)}
                  accessibilityLabel={p.name}
                  style={({ pressed, hovered }) => [
                    styles.tr,
                    {
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: t.colors.line,
                      backgroundColor: pressed || hovered ? t.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <View style={[styles.cell, { flex: 3 }]}>
                    <Thumb p={p} />
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {p.name}
                    </Text>
                  </View>
                  <Text variant="callout" tone="secondary" style={{ flex: 1.6 }} numberOfLines={1}>
                    {tr(`supplier.category.${p.category}`)}
                  </Text>
                  <Text variant="bodyStrong" numeric style={{ flex: 1.3 }} align="right">
                    {kes(p.pricePerUnit)}
                  </Text>
                  <View style={{ flex: 1.3, alignItems: 'flex-end' }}>
                    <StockPill p={p} low={low.has(p.id)} />
                  </View>
                  <Text
                    variant="callout"
                    tone="secondary"
                    style={{ flex: 1.2 }}
                    align="right"
                    numberOfLines={1}
                  >
                    {p.county}
                  </Text>
                </Pressable>
              ))}
            </Card>
          ) : (
            <View style={styles.grid}>
              {list.map((p) => (
                <View key={p.id} style={{ width: size === 'medium' ? '48.8%' : '100%' }}>
                  <Card onPress={() => open(p.id)} accessibilityLabel={p.name} style={styles.card}>
                    <Thumb p={p} size={64} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text variant="headline" numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text variant="caption" tone="secondary">
                        {tr(`supplier.category.${p.category}`)}
                        {p.isOrganic ? ` · ${tr('agent.organicTag')}` : ''}
                      </Text>
                      <View style={styles.cardFoot}>
                        <Text variant="price" numeric>
                          {kes(p.pricePerUnit)}
                          <Text variant="caption" tone="tertiary">{`/${unitLabel(p.unit)}`}</Text>
                        </Text>
                        <StockPill p={p} low={low.has(p.id)} />
                      </View>
                    </View>
                  </Card>
                </View>
              ))}
            </View>
          )}
          {products.hasNextPage && (
            <Button
              label={tr('agent.loadMore')}
              variant="outline"
              loading={products.isFetchingNextPage}
              onPress={() => void products.fetchNextPage()}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

function Thumb({ p, size = 40 }: { p: InputProductListItemDto; size?: number }) {
  const t = useTheme();
  if (p.photoUrls[0]) return <ProduceImage uri={p.photoUrls[0]} size={size} radius={10} />;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        backgroundColor: t.colors.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={CATEGORY_ICON[p.category]} size={size * 0.45} color={t.colors.primary} />
    </View>
  );
}

function StockPill({ p, low }: { p: InputProductListItemDto; low: boolean }) {
  const { t: tr } = useTranslation();
  if (!p.active) return <Pill label={tr('supplier.hiddenTag')} tone="neutral" icon="eyeOff" size="sm" />;
  const tone = p.stock === 0 ? 'danger' : low ? 'warning' : 'neutral';
  return (
    <Pill
      label={p.stock === 0 ? tr('supplier.outOfStock') : `${qty(p.stock)} ${unitLabel(p.unit, p.stock)}`}
      tone={tone}
      size="sm"
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    minHeight: 56,
    paddingVertical: 10,
  },
  cell: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
