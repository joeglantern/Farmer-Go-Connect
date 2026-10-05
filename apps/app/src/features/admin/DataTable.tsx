import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import type { StateKey } from '../../assets/registry';
import { humanError } from '../../lib/errors';
import { type SizeClass, useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

export interface Column<T> {
  key: string;
  title: string;
  /** Fixed width in dp; otherwise the column flexes. */
  width?: number;
  flex?: number;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Value to sort by; the column header becomes a sort button when set. */
  sort?: (row: T) => string | number | null | undefined;
  /** Hide the column on narrower tables. */
  hideBelow?: 'expanded';
  /** Shown as the card title on phones (first column by default). */
  primary?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  keyOf: (row: T) => string;
  onRowPress?: (row: T) => void;
  rowLabel?: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { art: StateKey; title: string; body?: string; action?: { label: string; onPress: () => void } };
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Filters and titles rendered above the table; scrolls with it. */
  header?: ReactNode;
  footer?: ReactNode;
  /** Phone rendering of a row. Default: card built from the columns. */
  renderCard?: (row: T) => ReactNode;
  /** Initial sort. */
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** Force cards even on wide screens (short lists inside detail screens). */
  cards?: boolean;
  contentPadding?: number;
  /** Width class override, for tests and previews. */
  size?: SizeClass;
}

const HEADER_ROW = '__header__';
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5', 's6'];

/**
 * Data table for the admin console. Expanded and medium widths: sortable columns, sticky
 * header, row hover, cursor pagination. Compact width: one card per row. Owns the scroll so
 * put it in a `Screen scroll={false}`.
 */
export function DataTable<T>({
  rows,
  columns,
  keyOf,
  onRowPress,
  rowLabel,
  loading,
  error,
  onRetry,
  empty,
  hasMore,
  loadingMore,
  onLoadMore,
  refreshing,
  onRefresh,
  header,
  footer,
  renderCard,
  defaultSort,
  cards,
  contentPadding,
  size: sizeOverride,
}: DataTableProps<T>) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const measured = useSizeClass();
  const size = sizeOverride ?? measured;
  const asCards = cards || size === 'compact';
  const gutter = contentPadding ?? (size === 'compact' ? 20 : 32);
  const [sort, setSort] = useState(defaultSort ?? null);

  const visible = useMemo(
    () => columns.filter((c) => !(c.hideBelow === 'expanded' && size !== 'expanded')),
    [columns, size],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((cur) =>
      cur?.key === key ? (cur.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' },
    );

  const primaryCol = visible.find((c) => c.primary) ?? visible[0];

  const headerRow = (
    <View
      style={[
        styles.headerRow,
        { backgroundColor: t.colors.bg, borderBottomColor: t.colors.lineStrong, paddingHorizontal: gutter },
      ]}
      accessibilityRole="header"
    >
      <View
        style={[
          styles.row,
          {
            backgroundColor: t.colors.surfaceMuted,
            borderTopLeftRadius: t.radius.sm,
            borderTopRightRadius: t.radius.sm,
          },
        ]}
      >
        {visible.map((c) => {
          const active = sort?.key === c.key;
          const cell = (
            <View style={[styles.headerCell, c.align === 'right' && styles.right]}>
              <Text
                variant="micro"
                tone={active ? 'brand' : 'tertiary'}
                numberOfLines={1}
                style={{ letterSpacing: 0.5 }}
              >
                {c.title.toUpperCase()}
              </Text>
              {c.sort && (
                <Icon
                  name={active ? (sort?.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'}
                  size={12}
                  color={active ? t.colors.primary : t.colors.textTertiary}
                />
              )}
            </View>
          );
          return (
            <View key={c.key} style={cellStyle(c)}>
              {c.sort ? (
                <Pressable
                  onPress={() => toggleSort(c.key)}
                  accessibilityLabel={tr('admin.table.sortBy', { column: c.title })}
                  accessibilityState={{ selected: active }}
                  focusRadius={6}
                  hitSlop={6}
                >
                  {cell}
                </Pressable>
              ) : (
                cell
              )}
            </View>
          );
        })}
      </View>
    </View>
  );

  const defaultCard = (row: T) => (
    <Card
      onPress={onRowPress ? () => onRowPress(row) : undefined}
      accessibilityLabel={rowLabel?.(row)}
      style={{ gap: 10 }}
    >
      {primaryCol && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {primaryCol.render(row)}
          {onRowPress && <Icon name="chevronRight" size={16} color={t.colors.textTertiary} />}
        </View>
      )}
      <View style={styles.cardGrid}>
        {columns
          .filter((c) => c !== primaryCol)
          .map((c) => (
            <View key={c.key} style={styles.cardCell}>
              <Text variant="micro" tone="tertiary" style={{ letterSpacing: 0.4 }}>
                {c.title.toUpperCase()}
              </Text>
              <View style={{ alignItems: 'flex-start' }}>{c.render(row)}</View>
            </View>
          ))}
      </View>
    </Card>
  );

  const renderRow = (row: T, index: number) => {
    if (asCards)
      return (
        <View style={{ paddingHorizontal: gutter, paddingBottom: 12 }}>
          {renderCard ? renderCard(row) : defaultCard(row)}
        </View>
      );
    const last = index === sorted.length - 1;
    const body = ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => (
      <View
        style={[
          styles.row,
          styles.bodyRow,
          {
            backgroundColor: pressed
              ? t.colors.primaryTint
              : hovered
                ? t.colors.surfaceMuted
                : t.colors.surface,
            borderBottomColor: t.colors.line,
            borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2,
            borderBottomLeftRadius: last ? t.radius.sm : 0,
            borderBottomRightRadius: last ? t.radius.sm : 0,
          },
        ]}
      >
        {visible.map((c) => (
          <View key={c.key} style={[cellStyle(c), c.align === 'right' && { alignItems: 'flex-end' }]}>
            {c.render(row)}
          </View>
        ))}
      </View>
    );
    return (
      <View style={{ paddingHorizontal: gutter }}>
        {onRowPress ? (
          <Pressable
            onPress={() => onRowPress(row)}
            accessibilityLabel={rowLabel?.(row)}
            focusRadius={4}
            haptics="selection"
          >
            {(s: { hovered?: boolean; pressed: boolean }) => body(s)}
          </Pressable>
        ) : (
          body({})
        )}
      </View>
    );
  };

  const stateBlock = (() => {
    if (loading && rows.length === 0) {
      return (
        <View
          style={{ paddingHorizontal: gutter, gap: asCards ? 12 : 0 }}
          accessibilityRole="progressbar"
          accessibilityLabel={tr('common.loading')}
        >
          {SKELETON_ROWS.map((id) => (
            <Skeleton
              key={id}
              height={asCards ? 108 : 52}
              radius={asCards ? 14 : 0}
              style={!asCards && { marginBottom: 2 }}
            />
          ))}
        </View>
      );
    }
    if (error && rows.length === 0) {
      return (
        <View style={{ paddingHorizontal: gutter }}>
          <ErrorState message={humanError(error)} onRetry={onRetry} />
        </View>
      );
    }
    if (!loading && rows.length === 0) {
      return (
        <View style={{ paddingHorizontal: gutter }}>
          <EmptyState art={empty.art} title={empty.title} body={empty.body} action={empty.action} />
        </View>
      );
    }
    return null;
  })();

  const data: (T | typeof HEADER_ROW)[] = stateBlock ? [] : asCards ? sorted : [HEADER_ROW, ...sorted];

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => (item === HEADER_ROW ? HEADER_ROW : keyOf(item as T))}
      renderItem={({ item, index }) =>
        item === HEADER_ROW ? headerRow : renderRow(item as T, index - (asCards ? 0 : 1))
      }
      stickyHeaderIndices={!asCards && data.length > 0 ? [header ? 1 : 0] : undefined}
      ListHeaderComponent={header ? <View style={{ paddingHorizontal: gutter }}>{header}</View> : null}
      ListEmptyComponent={stateBlock}
      ListFooterComponent={
        <View style={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 32, gap: 12 }}>
          {loadingMore && <ActivityIndicator color={t.colors.primary} />}
          {hasMore && !loadingMore && onLoadMore && rows.length > 0 && (
            <Button
              label={tr('admin.table.loadMore')}
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={onLoadMore}
              style={{ alignSelf: 'center' }}
            />
          )}
          {!hasMore && rows.length > 0 && (
            <Text variant="caption" tone="tertiary" align="center" numeric>
              {tr('admin.table.count', { count: rows.length })}
            </Text>
          )}
          {footer}
        </View>
      }
      onEndReached={() => hasMore && !loadingMore && onLoadMore?.()}
      onEndReachedThreshold={0.6}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.primary}
            colors={[t.colors.primary]}
          />
        ) : undefined
      }
      contentContainerStyle={{
        paddingTop: 4,
        width: '100%',
        maxWidth: t.layout.contentMax + gutter * 2,
        alignSelf: 'center',
      }}
      showsVerticalScrollIndicator={Platform.OS === 'web'}
      keyboardShouldPersistTaps="handled"
    />
  );
}

function cellStyle<T>(c: Column<T>) {
  return c.width ? { width: c.width } : { flex: c.flex ?? 1, minWidth: 0 };
}

const styles = StyleSheet.create({
  headerRow: { paddingTop: 8, borderBottomWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 44 },
  bodyRow: { minHeight: 56, paddingVertical: 8 },
  headerCell: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  right: { justifyContent: 'flex-end' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  cardCell: { width: '50%', gap: 2, paddingRight: 8 },
});
