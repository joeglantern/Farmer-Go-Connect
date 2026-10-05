import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSizeClass, useTheme } from '../theme/theme';
import { IconButton } from './Button';
import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  /** Scrolls by default; set false for screens that manage their own lists. */
  scroll?: boolean;
  /** Constrain content width on wide screens (forms, reading). */
  maxWidth?: number;
  padded?: boolean;
  /** Sticky bottom action area (e.g. "Proceed to Checkout"). */
  footer?: ReactNode;
  header?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Top safe-area padding; off when a header or band already covers it. */
  safeTop?: boolean;
  keyboard?: boolean;
}

export function Screen({
  children,
  scroll = true,
  maxWidth,
  padded = true,
  footer,
  header,
  refreshing,
  onRefresh,
  background,
  contentStyle,
  safeTop = true,
  keyboard = true,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const width = maxWidth ?? (size === 'compact' ? undefined : t.layout.contentMax);
  const gutter = padded ? (size === 'compact' ? 20 : 32) : 0;

  const inner = (
    <View
      style={[
        { width: '100%', maxWidth: width, alignSelf: 'center', paddingHorizontal: gutter },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: header ? 0 : safeTop ? insets.top + 8 : 0,
        paddingBottom: footer ? 24 : insets.bottom + 32,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
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
    >
      {inner}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingTop: header ? 0 : safeTop ? insets.top : 0 }}>{inner}</View>
  );

  const content = (
    <View style={[styles.root, { backgroundColor: background ?? t.colors.bg }]}>
      {header}
      {body}
      {footer && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: t.colors.surface,
              borderTopColor: t.colors.line,
              paddingBottom: Math.max(insets.bottom, 12) + 4,
            },
          ]}
        >
          <View
            style={{
              width: '100%',
              maxWidth: width ?? undefined,
              alignSelf: 'center',
              paddingHorizontal: gutter,
              gap: 12,
            }}
          >
            {footer}
          </View>
        </View>
      )}
    </View>
  );

  if (!keyboard || Platform.OS === 'web') return content;
  // Android is edge-to-edge (SDK 57), so the window no longer resizes for the keyboard: pad on
  // both platforms so the sticky footer and the focused field stay above it.
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {content}
    </KeyboardAvoidingView>
  );
}

/**
 * Screen header: back button, title, trailing actions. `large` for top-level screens
 * (title below the bar), compact for detail screens.
 */
export function Header({
  title,
  subtitle,
  back = true,
  onBack,
  right,
  large,
  tone = 'default',
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
  tone?: 'default' | 'brand';
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr } = useTranslation();
  const brand = tone === 'brand';
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  const backButton = back ? (
    <IconButton
      icon="back"
      label={tr('common.back')}
      onPress={goBack}
      variant={brand ? 'onBrand' : 'plain'}
      color={brand ? '#FFFFFF' : undefined}
    />
  ) : null;

  // Large (top-level) titles sit directly under the status bar / Dynamic Island. The back and
  // action row is only drawn when it has something in it, so there is no empty band above.
  if (large && title) {
    return (
      <View
        style={{
          paddingTop: insets.top + (back ? 4 : 12),
          paddingBottom: 10,
          backgroundColor: brand ? t.colors.band : t.colors.bg,
        }}
      >
        {back ? <View style={[styles.bar, { minHeight: 44 }]}>{backButton}</View> : null}
        <View style={styles.largeRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              variant="title1"
              tone={brand ? 'onBrand' : 'default'}
              accessibilityRole="header"
              numberOfLines={2}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="callout" tone={brand ? 'onBrandMuted' : 'secondary'}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingTop: insets.top + 4,
        paddingBottom: 4,
        backgroundColor: brand ? t.colors.band : t.colors.bg,
      }}
    >
      <View style={styles.bar}>
        {backButton ?? <View style={{ width: 12 }} />}
        {title ? (
          <View style={{ flex: 1 }}>
            <Text
              variant="title3"
              numberOfLines={1}
              tone={brand ? 'onBrand' : 'default'}
              accessibilityRole="header"
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone={brand ? 'onBrandMuted' : 'secondary'} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

export function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      {action && onAction && (
        <Text
          variant="calloutStrong"
          tone="brand"
          onPress={onAction}
          accessibilityRole="link"
          suppressHighlighting
          style={{ paddingVertical: 6, paddingLeft: 12, color: t.colors.primary }}
        >
          {action}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 48 },
  largeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 12,
  },
});
