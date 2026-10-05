import { type Href, router, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type PlatformRole, useSession } from '../data/session';
import i18n from '../i18n';
import { useTheme } from '../theme/theme';
import { LeafMark, LogoInline } from '../ui/brand/Logo';
import { Avatar } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Pressable } from '../ui/Pressable';
import { Text } from '../ui/Text';
import { type NavItem, navFor, tabsFor } from './config';

const hrefPath = (h: Href) => (typeof h === 'string' ? h : (h as { pathname: string }).pathname);

function isActive(pathname: string, item: NavItem) {
  const p = hrefPath(item.href);
  return pathname === p || (p !== '/home' && pathname.startsWith(`${p}/`));
}

export function useRole(): PlatformRole {
  return useSession((s) => s.me?.user.role ?? 'user');
}

/** Paths where the phone tab bar shows (top-level destinations only). */
export function useShowsTabBar(): boolean {
  const pathname = usePathname();
  const role = useRole();
  return tabsFor(role).some((i) => hrefPath(i.href) === pathname);
}

/** Phone bottom navigation (mockup: Home, Orders, Messages, Profile). */
export function TabBar({ badges }: { badges?: Partial<Record<string, number>> }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const items = tabsFor(useRole());
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabBar,
        {
          backgroundColor: t.colors.surface,
          borderTopColor: t.colors.line,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {items.map((item) => {
        const active = isActive(pathname, item);
        if (item.primary) {
          return (
            <View key={item.key} style={styles.tab}>
              <Pressable
                onPress={() => router.navigate(item.href)}
                haptics="medium"
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tr(item.labelKey)}
                focusRadius={28}
                style={({ pressed }) => [
                  styles.fab,
                  {
                    backgroundColor: pressed ? t.colors.primaryPressed : t.colors.primary,
                    borderColor: t.colors.surface,
                  },
                  t.elevation.raised,
                ]}
              >
                <Icon name={item.icon} size={26} color="#FFFFFF" weight="bold" />
              </Pressable>
              <Text
                variant="micro"
                style={{ color: active ? t.colors.primary : t.colors.textTertiary, marginTop: 2 }}
              >
                {tr(item.labelKey)}
              </Text>
            </View>
          );
        }
        const badge = badges?.[item.key];
        return (
          <Pressable
            key={item.key}
            onPress={() => router.navigate(item.href)}
            haptics="selection"
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={badge ? `${tr(item.labelKey)}, ${badge}` : tr(item.labelKey)}
            focusRadius={12}
            style={styles.tab}
          >
            <View>
              <Icon
                name={item.icon}
                size={24}
                color={active ? t.colors.primary : t.colors.textTertiary}
                weight={active ? 'fill' : 'regular'}
              />
              {!!badge && (
                <View
                  style={[styles.dot, { backgroundColor: t.colors.danger, borderColor: t.colors.surface }]}
                >
                  <Text variant="micro" style={{ color: '#FFFFFF', fontSize: 9, lineHeight: 11 }} numeric>
                    {badge > 9 ? '9+' : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text variant="micro" style={{ color: active ? t.colors.primary : t.colors.textTertiary }}>
              {tr(item.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tablet / unfolded foldable navigation rail. */
export function Rail({ badges }: { badges?: Partial<Record<string, number>> }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const me = useSession((s) => s.me);
  const sections = navFor(useRole());
  const items = sections.flatMap((s) => s.items).filter((i) => i.key !== 'profile');
  return (
    <View
      style={[
        styles.rail,
        {
          backgroundColor: t.colors.surface,
          borderRightColor: t.colors.line,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        },
      ]}
    >
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <Pressable
          onPress={() => router.navigate('/home')}
          accessibilityLabel={i18n.t('common.homeLink')}
          focusRadius={12}
        >
          <LogoMarkOnly />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ gap: 4, alignItems: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        {items.map((item) => {
          const active = isActive(pathname, item);
          const badge = badges?.[item.key];
          return (
            <Pressable
              key={item.key}
              onPress={() => router.navigate(item.href)}
              haptics="selection"
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tr(item.labelKey)}
              focusRadius={16}
              style={styles.railItem}
            >
              {({ hovered }: { hovered?: boolean }) => (
                <>
                  <View
                    style={[
                      styles.railPill,
                      {
                        backgroundColor: item.primary
                          ? t.colors.primary
                          : active
                            ? t.colors.primaryTintStrong
                            : hovered
                              ? t.colors.surfaceMuted
                              : 'transparent',
                      },
                    ]}
                  >
                    <Icon
                      name={item.icon}
                      size={22}
                      color={item.primary ? '#FFFFFF' : active ? t.colors.primary : t.colors.textSecondary}
                      weight={active || item.primary ? 'fill' : 'regular'}
                    />
                    {!!badge && <View style={[styles.railDot, { backgroundColor: t.colors.danger }]} />}
                  </View>
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    style={{ color: active ? t.colors.primary : t.colors.textSecondary, textAlign: 'center' }}
                  >
                    {tr(item.labelKey)}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        onPress={() => router.navigate('/profile')}
        accessibilityLabel={tr('tabs.profile')}
        style={{ alignItems: 'center', marginTop: 8 }}
        focusRadius={24}
      >
        <Avatar name={me?.user.name} uri={me?.user.image} size={40} />
      </Pressable>
    </View>
  );
}

function LogoMarkOnly() {
  return <LeafMark size={40} />;
}

/** Desktop sidebar with labels, sections, organization and profile. */
export function Sidebar({ badges }: { badges?: Partial<Record<string, number>> }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const me = useSession((s) => s.me);
  const orgId = useSession((s) => s.orgId);
  const sections = navFor(useRole());
  const org =
    me?.organizations.find((o) => o.id === (orgId ?? me.activeOrganizationId)) ?? me?.organizations[0];

  return (
    <View
      style={[
        styles.sidebar,
        {
          backgroundColor: t.colors.surface,
          borderRightColor: t.colors.line,
          width: t.layout.sidebar,
          paddingTop: insets.top + 20,
        },
      ]}
    >
      <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
        <Pressable
          onPress={() => router.navigate('/home')}
          accessibilityLabel={i18n.t('common.homeLink')}
          focusRadius={12}
        >
          <LogoInline />
        </Pressable>
      </View>

      {org && (
        <View style={[styles.orgCard, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.md }]}>
          <View style={[styles.orgIcon, { backgroundColor: t.colors.primary }]}>
            <Icon
              name={org.profile?.type === 'INPUT_SUPPLIER' ? 'sprout' : 'building'}
              size={18}
              color="#FFFFFF"
              weight="fill"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="calloutStrong" numberOfLines={1}>
              {org.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {org.profile?.county ?? ''}
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section, si) => (
          <View key={section.titleKey ?? 'main'} style={{ marginTop: si === 0 ? 4 : 20, gap: 2 }}>
            {section.titleKey && (
              <Text
                variant="micro"
                tone="tertiary"
                style={{ paddingHorizontal: 12, marginBottom: 6, letterSpacing: 0.6 }}
              >
                {tr(section.titleKey).toUpperCase()}
              </Text>
            )}
            {section.items
              .filter((i) => i.key !== 'profile' || si > 0)
              .map((item) => {
                const active = isActive(pathname, item);
                const badge = badges?.[item.key];
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => router.navigate(item.href)}
                    haptics="selection"
                    accessibilityRole="link"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={tr(item.labelKey)}
                    focusRadius={12}
                    style={({ hovered, pressed }) => [
                      styles.sideItem,
                      {
                        borderRadius: 12,
                        backgroundColor: active
                          ? t.colors.primaryTintStrong
                          : pressed || hovered
                            ? t.colors.surfaceMuted
                            : 'transparent',
                      },
                    ]}
                  >
                    <Icon
                      name={item.icon}
                      size={20}
                      color={active ? t.colors.primary : t.colors.textSecondary}
                      weight={active ? 'fill' : 'regular'}
                    />
                    <Text
                      variant="calloutStrong"
                      style={{ flex: 1, color: active ? t.colors.primary : t.colors.text }}
                    >
                      {tr(item.labelKey)}
                    </Text>
                    {!!badge && (
                      <View style={[styles.sideBadge, { backgroundColor: t.colors.danger }]}>
                        <Text variant="micro" style={{ color: '#FFFFFF' }} numeric>
                          {badge > 99 ? '99+' : badge}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
          </View>
        ))}
      </ScrollView>

      <Pressable
        onPress={() => router.navigate('/profile')}
        accessibilityLabel={`${tr('tabs.profile')}, ${me?.user.name ?? ''}`}
        focusRadius={12}
        style={({ hovered }) => [
          styles.profileRow,
          {
            borderTopColor: t.colors.line,
            backgroundColor: hovered || pathname === '/profile' ? t.colors.surfaceMuted : 'transparent',
            paddingBottom: insets.bottom + 14,
          },
        ]}
      >
        <Avatar name={me?.user.name} uri={me?.user.image} size={38} />
        <View style={{ flex: 1 }}>
          <Text variant="calloutStrong" numberOfLines={1}>
            {me?.user.name ?? ''}
          </Text>
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {tr(`roles.${me?.user.role ?? 'user'}`)}
          </Text>
        </View>
        <Icon name="settings" size={18} color={t.colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 52 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    borderWidth: 4,
  },
  dot: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  rail: { width: 88, borderRightWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center' },
  railItem: { alignItems: 'center', gap: 4, width: 76, paddingVertical: 6 },
  railPill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  railDot: { position: 'absolute', top: 4, right: 14, width: 8, height: 8, borderRadius: 4 },
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth * 2 },
  orgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  orgIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 44 },
  sideBadge: {
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
});
