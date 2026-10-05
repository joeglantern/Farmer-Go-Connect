import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/theme';
import { palette } from '../../theme/tokens';
import { Text } from '../Text';

/**
 * The FarmGo leaf mark, redrawn from the mockup: two leaves rising from one stem, a deep
 * green leaf on the left and a lighter lime leaf on the right. Each leaf is split along its
 * midrib into two flat tones for depth (no gradients).
 */
export function LeafMark({ size = 64, mono }: { size?: number; mono?: string }) {
  const g = palette.green;
  const c = mono
    ? { a: mono, b: mono, c: mono, d: mono, stem: mono }
    : { a: g[700], b: g[600], c: palette.lime, d: '#A5C23F', stem: g[800] };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityRole="image"
      accessibilityLabel="FarmGo"
    >
      {/* Left leaf */}
      <Path d="M47 86 C 20 80 5 52 10 18 C 40 22 58 50 47 86 Z" fill={c.a} />
      <Path d="M47 86 C 40 60 27 38 10 18 C 40 22 58 50 47 86 Z" fill={c.b} opacity={mono ? 0.75 : 1} />
      {/* Right leaf */}
      <Path d="M51 88 C 50 52 66 22 94 10 C 100 44 84 76 51 88 Z" fill={c.c} />
      <Path d="M51 88 C 62 60 76 34 94 10 C 100 44 84 76 51 88 Z" fill={c.d} opacity={mono ? 0.75 : 1} />
      {/* Stem */}
      <Path
        d="M49 96 C 48 90 47 84 44 76"
        stroke={c.stem}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** Stacked wordmark from the mockup: bold "FarmGo" over lighter "Connect". */
export function Wordmark({
  size = 'lg',
  inverse,
  align = 'center',
}: {
  size?: 'sm' | 'md' | 'lg';
  inverse?: boolean;
  align?: 'center' | 'left';
}) {
  const t = useTheme();
  const s = { sm: [20, 17], md: [28, 24], lg: [38, 32] }[size];
  return (
    <View
      style={{ alignItems: align === 'center' ? 'center' : 'flex-start' }}
      accessible
      accessibilityLabel="FarmGo Connect"
    >
      <Text
        style={{
          fontFamily: t.fonts.extrabold,
          fontSize: s[0],
          lineHeight: s[0] * 1.08,
          letterSpacing: -0.8,
          color: inverse ? '#FFFFFF' : t.scheme === 'dark' ? '#FFFFFF' : palette.green[950],
        }}
      >
        FarmGo
      </Text>
      <Text
        style={{
          fontFamily: t.fonts.medium,
          fontSize: s[1],
          lineHeight: s[1] * 1.1,
          letterSpacing: -0.3,
          color: inverse ? palette.lime : t.colors.leaf,
          marginTop: -2,
        }}
      >
        Connect
      </Text>
    </View>
  );
}

/** Mark and wordmark together, as on the welcome and sign-up screens. */
export function Logo({ size = 'lg', inverse }: { size?: 'sm' | 'md' | 'lg'; inverse?: boolean }) {
  const mark = { sm: 36, md: 52, lg: 72 }[size];
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <LeafMark size={mark} />
      <Wordmark size={size} inverse={inverse} />
    </View>
  );
}

/** Horizontal lockup for sidebars and headers. */
export function LogoInline({ inverse }: { inverse?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LeafMark size={36} />
      <Wordmark size="sm" inverse={inverse} align="left" />
    </View>
  );
}
