import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Modal, Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import i18n from '../../i18n';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { haptic } from '../Pressable';
import { Text } from '../Text';

export interface DialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a red confirm button and a warning haptic. */
  destructive?: boolean;
  icon?: IconName;
  /** Hide the cancel button (information dialogs). */
  alertOnly?: boolean;
}

interface DialogState extends DialogOptions {
  resolve: (ok: boolean) => void;
}

interface DialogApi {
  confirm: (o: DialogOptions) => Promise<boolean>;
  alert: (o: Omit<DialogOptions, 'alertOnly' | 'cancelLabel'>) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * App-wide confirm and alert dialogs, drawn in the FarmGo style. Replaces Alert.alert and
 * window.confirm everywhere. `await dialog.confirm({...})` resolves true or false.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const queue = useRef<DialogState[]>([]);

  const show = useCallback((s: DialogState) => {
    setState((cur) => {
      if (cur) {
        queue.current.push(s);
        return cur;
      }
      return s;
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setState((cur) => {
      cur?.resolve(ok);
      return queue.current.shift() ?? null;
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) =>
        new Promise<boolean>((resolve) => {
          if (o.destructive) haptic('warning');
          show({ ...o, resolve });
        }),
      alert: (o) =>
        new Promise<void>((resolve) => {
          show({ ...o, alertOnly: true, resolve: () => resolve() });
        }),
    }),
    [show],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {state && <DialogView state={state} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ state, onClose }: { state: DialogState; onClose: (ok: boolean) => void }) {
  const t = useTheme();
  const size = useSizeClass();
  const stacked = size === 'compact';

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose(false);
      return true;
    });
    if (Platform.OS !== 'web') return () => sub.remove();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      sub.remove();
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const confirmLabel = state.confirmLabel ?? (state.alertOnly ? 'OK' : 'Confirm');
  const cancelLabel = state.cancelLabel ?? 'Cancel';

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={() => onClose(false)}
      statusBarTranslucent
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Animated.View
          entering={FadeIn.duration(t.motion.base)}
          exiting={FadeOut.duration(t.motion.fast)}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]}
        >
          {/* Tapping outside cancels, like the platform dialogs. */}
          <View
            style={StyleSheet.absoluteFill}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => onClose(false)}
            accessibilityLabel={i18n.t('common.closeDialog')}
          />
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(t.motion.base).easing(easeOut)}
          exiting={FadeOut.duration(t.motion.fast)}
          accessibilityRole="alert"
          style={[
            styles.card,
            { backgroundColor: t.colors.surface, borderRadius: t.radius.xl },
            t.elevation.overlay,
          ]}
        >
          {state.icon && (
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: state.destructive ? t.colors.dangerTint : t.colors.primaryTint },
              ]}
            >
              <Icon
                name={state.icon}
                size={26}
                color={state.destructive ? t.colors.danger : t.colors.primary}
                weight="bold"
              />
            </View>
          )}
          <View style={{ gap: 8 }}>
            <Text variant="title3" accessibilityRole="header">
              {state.title}
            </Text>
            {state.message && (
              <Text variant="callout" tone="secondary">
                {state.message}
              </Text>
            )}
          </View>
          <View style={[styles.actions, stacked ? styles.actionsStacked : styles.actionsRow]}>
            {!state.alertOnly && (
              <Button
                label={cancelLabel}
                variant="ghost"
                size="md"
                fullWidth={stacked}
                onPress={() => onClose(false)}
                haptics="selection"
              />
            )}
            <Button
              label={confirmLabel}
              variant={state.destructive ? 'danger' : 'primary'}
              size="md"
              fullWidth={stacked}
              onPress={() => onClose(true)}
              haptics={state.destructive ? 'medium' : 'light'}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider');
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, padding: 24, gap: 20 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 10 },
  actionsStacked: { flexDirection: 'column-reverse' },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});
