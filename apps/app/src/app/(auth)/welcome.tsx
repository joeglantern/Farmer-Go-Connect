import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { images } from '../../assets/registry';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { FieldArt } from '../../ui/brand/Art';
import { Logo } from '../../ui/brand/Logo';
import { LanguageToggle } from '../../ui/LanguageToggle';
import { Text } from '../../ui/Text';

const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** Mockup screen 1. */
export default function Welcome() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();
  const { height } = useWindowDimensions();
  const [introBottom, setIntroBottom] = useState(0);

  const hero = images.heroWelcome ? (
    <Image
      source={images.heroWelcome}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      contentPosition="top"
      transition={300}
    />
  ) : (
    <FieldArt dark={t.scheme === 'dark'} />
  );

  // Short phones (under 640 pt tall): a smaller brand block so the photo keeps the farmer's face
  // clear of the buttons (QA APP-017).
  const short = size === 'compact' && height < 640;
  const intro = (
    <View style={{ alignItems: 'center', gap: short ? 8 : 14 }}>
      <Logo size={short ? 'md' : 'lg'} />
      <Text
        variant={short ? 'title3' : 'title2'}
        tone="brand"
        align="center"
        style={{ marginTop: short ? 2 : 6 }}
      >
        {tr('welcome.tagline')}
      </Text>
      {short ? null : (
        <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 320 }}>
          {tr('welcome.body')}
        </Text>
      )}
    </View>
  );

  const actions = (
    <View style={{ gap: 12, width: '100%' }}>
      <Button label={tr('welcome.getStarted')} onPress={() => router.push('/role')} haptics="medium" />
      <Button label={tr('welcome.login')} variant="outline" onPress={() => router.push('/sign-in')} />
      <Text variant="caption" tone="tertiary" align="center" style={{ marginTop: 4 }}>
        {tr('welcome.by')}
      </Text>
    </View>
  );

  if (size !== 'compact') {
    return (
      <View style={[styles.split, { backgroundColor: t.colors.bg }]}>
        <View style={[styles.splitMedia, { borderRadius: 28, margin: 16, overflow: 'hidden' }]}>{hero}</View>
        <View style={[styles.splitPanel, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.langRow}>
            <LanguageToggle />
          </View>
          <Animated.View entering={FadeInDown.duration(500).easing(ease)} style={styles.panelBody}>
            {intro}
            <View style={{ height: 36 }} />
            {actions}
          </Animated.View>
        </View>
      </View>
    );
  }

  // Phones: mockup screen 1. Brand block on the page colour, the farmer photo full-bleed below it,
  // its top dissolving into the page, the two actions resting on the bottom of the photo.
  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <View style={[styles.photo, { top: Math.max(height * 0.3, introBottom - 70) }]}>
        {hero}
        <Svg style={styles.fade} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
          <Defs>
            <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={t.colors.bg} stopOpacity="1" />
              <Stop offset="1" stopColor={t.colors.bg} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#fade)" />
        </Svg>
      </View>
      <View
        style={{ paddingTop: insets.top + 8, paddingHorizontal: 20 }}
        onLayout={(e) => setIntroBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <View style={styles.langRow}>
          <LanguageToggle />
        </View>
        <Animated.View entering={FadeInDown.duration(500).easing(ease)} style={{ paddingHorizontal: 4 }}>
          {intro}
        </Animated.View>
      </View>
      <View style={{ flex: 1 }} />
      <Animated.View
        entering={FadeInDown.delay(160).duration(500).easing(ease)}
        style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24, gap: 12 }}
      >
        <Button label={tr('welcome.getStarted')} onPress={() => router.push('/role')} haptics="medium" />
        <Button label={tr('welcome.login')} variant="onPhoto" onPress={() => router.push('/sign-in')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  photo: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { position: 'absolute', left: 0, right: 0, top: 0, height: 140 },
  langRow: { alignItems: 'flex-end' },
  split: { flex: 1, flexDirection: 'row' },
  splitMedia: { flex: 1.15 },
  splitPanel: { flex: 1, paddingHorizontal: 40 },
  panelBody: { flex: 1, justifyContent: 'center', maxWidth: 420, width: '100%', alignSelf: 'center' },
});
