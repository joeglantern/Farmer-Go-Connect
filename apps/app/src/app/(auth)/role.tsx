import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { images } from '../../assets/registry';
import { type SignupRole, signupMethod, useSignupIntent } from '../../data/signup-intent';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Logo } from '../../ui/brand/Logo';
import { Icon, type IconName } from '../../ui/Icon';
import { LanguageToggle } from '../../ui/LanguageToggle';
import { Pressable } from '../../ui/Pressable';
import { Header, Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';

const ROLES: { key: SignupRole; icon: IconName }[] = [
  { key: 'hotel', icon: 'building' },
  { key: 'farmer', icon: 'plant' },
  { key: 'youth', icon: 'sprout' },
  { key: 'household', icon: 'house' },
];

const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** Mockup screen 2: "Create Your Account". */
export default function RolePicker() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const setRole = useSignupIntent((s) => s.setRole);

  const pick = (r: SignupRole) => {
    setRole(r);
    router.push({ pathname: '/sign-up', params: { method: signupMethod(r) } });
  };

  return (
    <Screen
      maxWidth={560}
      header={<Header right={<LanguageToggle />} />}
      footer={
        <View style={styles.footerRow}>
          <Text variant="callout" tone="secondary">
            {tr('role.haveAccount')}
          </Text>
          <Pressable
            onPress={() => router.push('/sign-in')}
            accessibilityRole="link"
            accessibilityLabel={tr('welcome.login')}
            focusRadius={6}
            hitSlop={10}
          >
            <Text variant="calloutStrong" tone="brand">
              {tr('welcome.login')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ alignItems: 'center', marginTop: size === 'compact' ? 0 : 24 }}>
        <Logo size="md" />
      </View>
      <View style={{ gap: 6, marginTop: 28, marginBottom: 20 }}>
        <Text variant="title2" accessibilityRole="header">
          {tr('role.title')}
        </Text>
        <Text variant="callout" tone="secondary">
          {tr('role.subtitle')}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {ROLES.map((r, i) => (
          <Animated.View
            key={r.key}
            entering={FadeInDown.delay(60 * i)
              .duration(420)
              .easing(ease)}
          >
            <Pressable
              onPress={() => pick(r.key)}
              haptics="selection"
              accessibilityLabel={`${tr(`role.${r.key}`)}. ${tr(`role.${r.key}Body`)}`}
              focusRadius={t.radius.md}
              style={({ pressed, hovered }) => [
                styles.card,
                {
                  backgroundColor: pressed || hovered ? t.colors.primaryTint : t.colors.surface,
                  borderColor: pressed || hovered ? t.colors.primary : t.colors.line,
                  borderRadius: t.radius.md,
                },
              ]}
            >
              <View style={[styles.art, { backgroundColor: t.colors.primaryTint }]}>
                {images.roles[r.key] ? (
                  <Image
                    source={images.roles[r.key]}
                    style={{ width: 70, height: 70 }}
                    contentFit="contain"
                    transition={200}
                  />
                ) : (
                  <Icon name={r.icon} size={28} color={t.colors.primary} weight="duotone" />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="headline">{tr(`role.${r.key}`)}</Text>
                <Text variant="caption" tone="secondary">
                  {tr(`role.${r.key}Body`)}
                </Text>
              </View>
              <Icon name="chevronRight" size={18} color={t.colors.textTertiary} />
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderWidth: 1.5,
    minHeight: 100,
  },
  art: {
    width: 76,
    height: 76,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  footerRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, alignItems: 'center', minHeight: 44 },
});
