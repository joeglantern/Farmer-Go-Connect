import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme, useWindowDimensions } from 'react-native';
import {
  breakpoints,
  type ColorRoles,
  darkColors,
  fonts,
  layout,
  lightColors,
  motion,
  radius,
  space,
  type,
} from './tokens';

export type SchemePreference = 'system' | 'light' | 'dark';
export type SizeClass = 'compact' | 'medium' | 'expanded';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorRoles;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  fonts: typeof fonts;
  motion: typeof motion;
  layout: typeof layout;
  /** Soft, offset shadows (never zero-offset halos). */
  elevation: {
    card: object;
    raised: object;
    overlay: object;
  };
}

function elevation(shadow: string, dark: boolean) {
  const make = (y: number, blur: number, opacity: number, androidElevation: number) =>
    Platform.select({
      web: { boxShadow: `0px ${y}px ${blur}px ${hexToRgba(shadow, dark ? opacity * 2 : opacity)}` },
      default: {
        shadowColor: shadow,
        shadowOffset: { width: 0, height: y },
        shadowOpacity: dark ? opacity * 2 : opacity,
        shadowRadius: blur / 2,
        elevation: androidElevation,
      },
    }) as object;
  return {
    card: make(2, 10, 0.06, 1),
    raised: make(8, 24, 0.1, 4),
    overlay: make(18, 48, 0.18, 12),
  };
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function buildTheme(scheme: 'light' | 'dark'): Theme {
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return {
    scheme,
    colors,
    space,
    radius,
    type,
    fonts,
    motion,
    layout,
    elevation: elevation(colors.shadow, scheme === 'dark'),
  };
}

interface ThemeContextValue {
  theme: Theme;
  preference: SchemePreference;
  setPreference: (p: SchemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'farmgo.scheme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<SchemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return {
      theme: buildTheme(scheme),
      preference,
      setPreference: (p) => {
        setPreferenceState(p);
        AsyncStorage.setItem(STORAGE_KEY, p).catch(() => undefined);
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx.theme;
}

export function useSchemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useSchemePreference must be used inside ThemeProvider');
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}

/** Window size class, recomputed live (foldables, split screen, browser resize). */
export function useSizeClass(): SizeClass {
  const { width } = useWindowDimensions();
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

/** Pick a value per size class, falling back to the next smaller class. */
export function useResponsive<T>(values: { compact: T; medium?: T; expanded?: T }): T {
  const size = useSizeClass();
  if (size === 'expanded') return values.expanded ?? values.medium ?? values.compact;
  if (size === 'medium') return values.medium ?? values.compact;
  return values.compact;
}
