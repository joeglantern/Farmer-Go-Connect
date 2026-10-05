import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import { useSizeClass, useTheme } from '../../theme/theme';
import { IconButton } from '../Button';
import { Text } from '../Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Sticky footer (primary action). */
  footer?: ReactNode;
  /** Allow closing by swipe, back and scrim tap. Turn off to guard unsaved input. */
  dismissible?: boolean;
  /** Content scrolls inside the sheet. */
  scroll?: boolean;
  maxWidth?: number;
}

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Bottom sheet on phones (drag handle, swipe down to dismiss), centered panel on tablets
 * and desktop. Keyboard aware. Used for focused sub-tasks: pickers, filters, forms.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  dismissible = true,
  scroll = true,
  maxWidth = 560,
}: SheetProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const size = useSizeClass();
  const insets = useSafeAreaInsets();
  const asPanel = size !== 'compact';
  const drag = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    drag.value = 0;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissible) onClose();
      return true;
    });
    if (Platform.OS !== 'web') return () => sub.remove();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      sub.remove();
      window.removeEventListener('keydown', onKey);
    };
  }, [visible, dismissible, onClose, drag]);

  const pan = Gesture.Pan()
    .enabled(!asPanel && dismissible)
    .activeOffsetY(8)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        drag.value = withTiming(800, { duration: 200 }, () => runOnJS(onClose)());
      } else {
        drag.value = withSpring(0, { damping: 22, stiffness: 260 });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));

  if (!visible) return null;

  const header = (title || dismissible) && (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: 2 }}>
        {title && (
          <Text variant="title3" accessibilityRole="header">
            {title}
          </Text>
        )}
        {subtitle && (
          <Text variant="callout" tone="secondary">
            {subtitle}
          </Text>
        )}
      </View>
      {dismissible && (
        <IconButton
          icon="close"
          label={tr('common.close')}
          onPress={onClose}
          variant="tinted"
          size={36}
          iconSize={18}
        />
      )}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 16 }}>{children}</View>
  );

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={() => dismissible && onClose()}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.root, asPanel ? styles.rootCenter : styles.rootBottom]}
        >
          <Animated.View
            entering={FadeIn.duration(t.motion.base)}
            exiting={FadeOut.duration(t.motion.fast)}
            style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]}
          >
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={() => true}
              onResponderRelease={() => dismissible && onClose()}
              accessibilityLabel={i18n.t('common.close')}
            />
          </Animated.View>

          <Animated.View
            accessibilityViewIsModal
            entering={
              asPanel
                ? ZoomIn.duration(t.motion.base).easing(easeOut)
                : SlideInDown.duration(t.motion.slow).easing(easeOut)
            }
            exiting={asPanel ? FadeOut.duration(t.motion.fast) : SlideOutDown.duration(t.motion.base)}
            style={[
              asPanel ? styles.panel : styles.sheet,
              {
                backgroundColor: t.colors.surface,
                maxWidth: asPanel ? maxWidth : undefined,
                paddingBottom: asPanel ? 0 : insets.bottom,
              },
              t.elevation.overlay,
              dragStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View>
                {!asPanel && (
                  <View style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: t.colors.lineStrong }]} />
                  </View>
                )}
                {header}
              </View>
            </GestureDetector>
            <View style={{ flexShrink: 1 }}>{body}</View>
            {footer && <View style={[styles.footer, { borderTopColor: t.colors.line }]}>{footer}</View>}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootBottom: { justifyContent: 'flex-end' },
  rootCenter: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  panel: { width: '100%', borderRadius: 24, maxHeight: '88%', paddingTop: 8 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  footer: { padding: 16, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth * 2, gap: 10 },
});
