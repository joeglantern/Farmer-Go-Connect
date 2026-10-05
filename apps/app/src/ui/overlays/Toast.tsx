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
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSizeClass, useTheme } from '../../theme/theme';
import { Icon, type IconName } from '../Icon';
import { haptic, Pressable } from '../Pressable';
import { Text } from '../Text';

export type ToastTone = 'default' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onPress: () => void };
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastApi {
  show: (o: ToastOptions | string) => void;
  success: (message: string, action?: ToastOptions['action']) => void;
  error: (message: string, action?: ToastOptions['action']) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Distance above the bottom edge, so toasts clear the tab bar on phones. */
let bottomOffset = 0;
export function setToastBottomOffset(px: number) {
  bottomOffset = px;
}

/**
 * Snackbar-style feedback: one at a time, bottom of the screen, optional action (Undo,
 * Retry). Announced to screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const queue = useRef<(ToastOptions & { id: number })[]>([]);
  const idRef = useRef(0);

  const next = useCallback(() => {
    setCurrent(queue.current.shift() ?? null);
  }, []);

  const show = useCallback((o: ToastOptions | string) => {
    const opts = typeof o === 'string' ? { message: o } : o;
    const item = { ...opts, id: ++idRef.current };
    if (opts.tone === 'success') haptic('success');
    if (opts.tone === 'error') haptic('error');
    setCurrent((cur) => {
      if (cur) {
        queue.current.push(item);
        return cur;
      }
      return item;
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, action) => show({ message, tone: 'success', action }),
      error: (message, action) => show({ message, tone: 'error', action, duration: action ? 7000 : 5000 }),
    }),
    [show],
  );
  globalToast = api;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current && <ToastView key={current.id} toast={current} onDone={next} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: ToastOptions; onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const size = useSizeClass();

  useEffect(() => {
    const d = toast.duration ?? 4000;
    if (d === 0) return;
    const timer = setTimeout(onDone, d);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  const icon: Partial<Record<ToastTone, IconName>> = {
    success: 'checkCircle',
    error: 'warning',
    warning: 'warning',
  };
  const accent = {
    default: t.colors.textOnBrandMuted,
    success: '#8FD6A0',
    error: '#FF9C8C',
    warning: '#F2C66D',
  }[toast.tone ?? 'default'];

  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        styles.host,
        { paddingBottom: insets.bottom + 16 + (size === 'compact' ? bottomOffset : 0) },
      ]}
    >
      <Animated.View
        entering={SlideInDown.duration(t.motion.slow).easing(Easing.bezier(0.16, 1, 0.3, 1))}
        exiting={FadeOut.duration(t.motion.fast)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          { backgroundColor: t.colors.band, borderRadius: t.radius.md },
          t.elevation.raised,
        ]}
      >
        {icon[toast.tone ?? 'default'] && (
          <Icon name={icon[toast.tone ?? 'default']!} size={20} color={accent} weight="fill" />
        )}
        <Text variant="callout" style={{ color: '#FFFFFF', flex: 1 }}>
          {toast.message}
        </Text>
        {toast.action && (
          <Pressable
            onPress={() => {
              toast.action?.onPress();
              onDone();
            }}
            accessibilityLabel={toast.action.label}
            hitSlop={10}
            focusRadius={8}
            style={styles.action}
          >
            <Text variant="calloutStrong" style={{ color: '#9EE0AE' }}>
              {toast.action.label}
            </Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

/** The mounted toast API, for code that runs outside components (stores, background syncs). */
let globalToast: ToastApi | null = null;
export function toastOutside(): ToastApi | null {
  return globalToast;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  host: { justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  toast: {
    width: '100%',
    maxWidth: 520,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  action: { paddingHorizontal: 4, paddingVertical: 6 },
});
