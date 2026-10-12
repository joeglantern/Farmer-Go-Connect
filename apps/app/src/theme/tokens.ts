/**
 * FarmGo Connect design tokens.
 * Derived from the mockup (design/reference/app-screens-mockup.png): fresh-produce greens,
 * white cards on a faintly green-tinted ground, pill buttons, photographic produce.
 * Every color used in the app comes from these roles; components never hard-code hex.
 */

const green = {
  950: '#082615',
  900: '#0E3B22', // deep forest: dashboard headers, footer bands, splash
  800: '#155230',
  700: '#1C6536', // primary: buttons, active tab, links
  600: '#257A42',
  500: '#3E9B4F', // leaf: wordmark "Connect", success, organic
  400: '#6BB37A',
  300: '#9CCB99',
  200: '#C4E0BD',
  100: '#DEECD4', // tint bands, selected chips
  50: '#EFF6EB',
};

export const palette = {
  green,
  lime: '#B9CF4B', // the light half of the leaf mark; decoration only, never text
  tomato: '#D8452E',
  carrot: '#E58A2B',
  maize: '#E6B422',
  sky: '#2D6A86',
  white: '#FFFFFF',
  black: '#000000',
};

export interface ColorRoles {
  /** App background behind cards. */
  bg: string;
  /** Cards, sheets, inputs. */
  surface: string;
  /** Slightly recessed surface: input fills, list hover, table stripes. */
  surfaceMuted: string;
  /** Raised surface on dark bands (cards over the green header). */
  surfaceRaised: string;
  /** Hairlines and dividers. */
  line: string;
  /** Input borders, stronger dividers. */
  lineStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on primary / dark green. */
  textOnBrand: string;
  textOnBrandMuted: string;

  primary: string;
  primaryPressed: string;
  primaryTint: string;
  primaryTintStrong: string;
  /** Green for text and icons on surfaces (links, outline buttons, brand pills). Brighter than primary in dark mode. */
  primaryContent: string;
  /** Deep forest bands (dashboard headers, promo footers). */
  band: string;
  bandText: string;
  leaf: string;
  accentLime: string;

  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerPressed: string;
  dangerTint: string;
  info: string;
  infoTint: string;
  star: string;
  heart: string;

  focus: string;
  scrim: string;
  shadow: string;
  skeleton: string;
  skeletonHighlight: string;
}

export const lightColors: ColorRoles = {
  bg: '#F4F7F3',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F6F2',
  surfaceRaised: '#FFFFFF',
  line: '#E3EAE4',
  lineStrong: '#CBD7CE',

  text: '#0D2418',
  textSecondary: '#3F5247',
  textTertiary: '#667a6e',
  textOnBrand: '#FFFFFF',
  textOnBrandMuted: '#CFE6D3',

  primary: green[700],
  primaryPressed: green[800],
  primaryTint: green[50],
  primaryTintStrong: green[100],
  primaryContent: green[700],
  band: green[900],
  bandText: '#FFFFFF',
  leaf: green[500],
  accentLime: palette.lime,

  success: green[600],
  successTint: green[50],
  warning: '#8A5A0B',
  warningTint: '#FBF0D9',
  danger: '#B83224',
  dangerPressed: '#982819',
  dangerTint: '#FBE9E6',
  info: '#245C75',
  infoTint: '#E3EFF4',
  star: '#E0A11B',
  heart: palette.tomato,

  focus: '#2F8F4A',
  scrim: 'rgba(8, 26, 16, 0.48)',
  shadow: '#0D2418',
  skeleton: '#E7EDE7',
  skeletonHighlight: '#F4F8F4',
};

/**
 * Dark: true black ground with neutral graphite steps. Green is an accent only
 * (primary actions, selected states, success), never the base. Elevation comes
 * from lighter graphite, not shadow. `primary` and `danger` sit in the narrow band
 * where white text on them and they on black both pass WCAG AA.
 */
export const darkColors: ColorRoles = {
  bg: '#000000',
  surface: '#141416',
  surfaceMuted: '#0C0C0E',
  surfaceRaised: '#1E1E22',
  line: 'rgba(255, 255, 255, 0.08)',
  lineStrong: 'rgba(255, 255, 255, 0.16)',

  text: '#F5F5F7',
  textSecondary: '#A8A8AF',
  textTertiary: '#8B8B93',
  textOnBrand: '#FFFFFF',
  textOnBrandMuted: '#D2DDD6',

  primary: '#118844',
  primaryPressed: '#0D7439',
  primaryTint: '#0F2318',
  primaryTintStrong: '#153222',
  primaryContent: '#34C766',
  band: '#121614',
  bandText: '#FFFFFF',
  leaf: '#34C766',
  accentLime: '#B4CC4A',

  success: '#34C766',
  successTint: '#10251A',
  warning: '#F2B84B',
  warningTint: '#2B2215',
  danger: '#D93B2D',
  dangerPressed: '#BE3124',
  dangerTint: '#2B1412',
  info: '#5AB0E0',
  infoTint: '#11222D',
  star: '#F5B83D',
  heart: '#FF6B57',

  focus: '#5BD682',
  scrim: 'rgba(0, 0, 0, 0.72)',
  shadow: '#000000',
  skeleton: '#18181B',
  skeletonHighlight: '#232327',
};

/** 4 pt grid. */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14, // cards, list tiles (mockup)
  lg: 18,
  xl: 24, // sheets, large media
  pill: 999, // buttons, chips, search (mockup)
} as const;

export const fonts = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  extrabold: 'Figtree_800ExtraBold',
} as const;

export type FontWeightName = keyof typeof fonts;

export interface TypeStyle {
  size: number;
  line: number;
  weight: FontWeightName;
  tracking?: number;
}

/** Type roles. Sizes are in sp/pt and scale with the user's text size setting. */
export const type = {
  display: { size: 34, line: 40, weight: 'extrabold', tracking: -0.6 },
  title1: { size: 28, line: 34, weight: 'bold', tracking: -0.4 },
  title2: { size: 22, line: 28, weight: 'bold', tracking: -0.2 },
  title3: { size: 18, line: 24, weight: 'semibold', tracking: -0.1 },
  headline: { size: 16, line: 22, weight: 'semibold' },
  body: { size: 15, line: 22, weight: 'regular' },
  bodyStrong: { size: 15, line: 22, weight: 'semibold' },
  callout: { size: 14, line: 20, weight: 'regular' },
  calloutStrong: { size: 14, line: 20, weight: 'semibold' },
  caption: { size: 13, line: 18, weight: 'medium' },
  micro: { size: 11, line: 14, weight: 'semibold', tracking: 0.3 },
  button: { size: 16, line: 20, weight: 'semibold' },
  buttonSmall: { size: 14, line: 18, weight: 'semibold' },
  statNumber: { size: 24, line: 30, weight: 'bold', tracking: -0.3 },
  price: { size: 17, line: 22, weight: 'bold' },
  priceLarge: { size: 24, line: 30, weight: 'bold', tracking: -0.3 },
} satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof type;

export const motion = {
  fast: 140,
  base: 220,
  slow: 340,
  /** Exponential ease-out: settles quickly, never bounces. */
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeInOut: [0.65, 0, 0.35, 1] as const,
};

/** Window size classes (dp). Layout follows the window, never the device model. */
export const breakpoints = {
  medium: 600,
  expanded: 1024,
  wide: 1440,
} as const;

export const layout = {
  /** Max width of reading/content columns on expanded screens. */
  contentMax: 1180,
  formMax: 520,
  sidebar: 264,
  rail: 88,
  tabBar: 64,
  touch: 48,
} as const;
