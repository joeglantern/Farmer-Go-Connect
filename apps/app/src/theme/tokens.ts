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

export const darkColors: ColorRoles = {
  bg: '#0A1510',
  surface: '#111E17',
  surfaceMuted: '#15241B',
  surfaceRaised: '#172A1F',
  line: '#213428',
  lineStrong: '#2F4838',

  text: '#EAF2EC',
  textSecondary: '#B2C4B8',
  textTertiary: '#869A8D',
  textOnBrand: '#FFFFFF',
  textOnBrandMuted: '#BFDCC5',

  primary: '#3F9E57',
  primaryPressed: '#358A4B',
  primaryTint: '#16301F',
  primaryTintStrong: '#1C3D27',
  band: '#0C2A18',
  bandText: '#FFFFFF',
  leaf: '#62B574',
  accentLime: '#A9BF45',

  success: '#5DB472',
  successTint: '#16301F',
  warning: '#E2B45A',
  warningTint: '#2F2613',
  danger: '#EE7A68',
  dangerPressed: '#E0624F',
  dangerTint: '#3A1C17',
  info: '#7CB9D3',
  infoTint: '#132A33',
  star: '#EBB441',
  heart: '#F0715C',

  focus: '#7BD08F',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
  skeleton: '#1A2B21',
  skeletonHighlight: '#22372A',
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
