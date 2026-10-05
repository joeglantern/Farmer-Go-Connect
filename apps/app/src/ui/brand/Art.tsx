import {
  type ImageSourcePropType,
  Image as RNImage,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import { images } from '../../assets/registry';
import { palette } from '../../theme/tokens';

const g = palette.green;

/**
 * Layered Kiambu-style field rows at morning light, drawn flat in brand greens. Stands in
 * for the hero photograph until it is delivered, and doubles as a quiet backdrop.
 */
export function FieldArt({ style, dark }: { style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const sky = dark ? '#10281A' : '#E9F2E4';
  const sun = dark ? '#1E3A27' : '#F4F1D8';
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
        <Rect width="400" height="600" fill={sky} />
        <Circle cx="300" cy="150" r="58" fill={sun} />
        {/* Far hills */}
        <Path
          d="M0 300 C 80 250 150 270 220 245 C 290 220 340 250 400 230 L400 600 L0 600 Z"
          fill={dark ? '#163823' : g[200]}
        />
        {/* Tree line */}
        <G fill={dark ? '#133220' : g[400]}>
          <Circle cx="40" cy="282" r="14" />
          <Circle cx="58" cy="276" r="18" />
          <Circle cx="330" cy="248" r="16" />
          <Circle cx="350" cy="242" r="20" />
          <Circle cx="372" cy="250" r="14" />
        </G>
        {/* Mid field */}
        <Path d="M0 340 C 120 310 260 330 400 300 L400 600 L0 600 Z" fill={dark ? '#1A4029' : g[300]} />
        <G stroke={dark ? '#23513A' : g[400]} strokeWidth="3" fill="none" opacity={0.7}>
          <Path d="M0 360 C 130 332 270 350 400 322" />
          <Path d="M0 382 C 130 356 270 372 400 346" />
          <Path d="M0 404 C 130 380 270 396 400 370" />
        </G>
        {/* Near field with crop rows converging */}
        <Path d="M0 420 C 140 400 260 410 400 390 L400 600 L0 600 Z" fill={dark ? '#1F5033' : g[500]} />
        <G stroke={dark ? '#2B6341' : g[600]} strokeWidth="6" strokeLinecap="round" fill="none">
          <Path d="M200 405 L 20 600" />
          <Path d="M210 405 L 110 600" />
          <Path d="M220 404 L 200 600" />
          <Path d="M230 403 L 290 600" />
          <Path d="M240 402 L 380 600" />
        </G>
        {/* Leaf clusters on the rows */}
        <G fill={dark ? '#347A4E' : g[400]}>
          <Circle cx="70" cy="560" r="12" />
          <Circle cx="150" cy="540" r="10" />
          <Circle cx="206" cy="520" r="9" />
          <Circle cx="266" cy="540" r="10" />
          <Circle cx="340" cy="560" r="12" />
          <Circle cx="118" cy="480" r="7" />
          <Circle cx="210" cy="470" r="6" />
          <Circle cx="290" cy="482" r="7" />
        </G>
      </Svg>
    </View>
  );
}

/**
 * Hand-drawn leaf lines on the forest band (mockup footer). Uses the generated leaf texture,
 * tiled; the SVG version draws only if that asset is missing. `opacity` is the strength of the
 * lines, 0.1 being the house default.
 */
export function LeafPattern({
  opacity = 0.1,
  color = '#FFFFFF',
  style,
}: {
  opacity?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (images.patterns.leaves) {
    return (
      <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
        <RNImage
          source={images.patterns.leaves as ImageSourcePropType}
          resizeMode="repeat"
          style={[
            StyleSheet.absoluteFill,
            { width: '100%', height: '100%', opacity: Math.min(1, opacity * 7) },
          ]}
        />
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="leaves" patternUnits="userSpaceOnUse" width="120" height="120">
            <G stroke={color} strokeWidth="1.2" fill="none" opacity={opacity} strokeLinecap="round">
              <Path d="M14 40 C 20 22 36 14 52 16 C 48 32 34 42 14 40 Z" />
              <Path d="M14 40 L 44 22" />
              <Path d="M78 96 C 82 78 98 70 112 74 C 108 90 94 98 78 96 Z" />
              <Path d="M78 96 L 104 80" />
              <Path d="M70 30 C 74 42 72 52 64 58" />
              <Path d="M24 86 C 30 80 38 80 44 86" />
              <Path d="M98 14 C 104 20 104 28 98 34" />
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#leaves)" />
      </Svg>
    </View>
  );
}

/** Paper or linen grain behind a pale surface. Very low contrast; decorative only. */
export function Texture({
  kind = 'paper',
  opacity = 0.6,
  style,
}: {
  kind?: 'paper' | 'linen' | 'rows';
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const src = images.patterns[kind];
  if (!src) return null;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <RNImage
        source={src as ImageSourcePropType}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity }]}
      />
    </View>
  );
}

/** Contour rows (ploughed terraces) for pale tinted headers. */
export function RowsPattern({
  color = g[500],
  opacity = 0.12,
  style,
}: {
  color?: string;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="rows" patternUnits="userSpaceOnUse" width="240" height="48">
            <G stroke={color} strokeWidth="1.4" fill="none" opacity={opacity}>
              <Path d="M0 12 C 60 2 120 22 240 10" />
              <Path d="M0 36 C 60 26 120 46 240 34" />
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#rows)" />
      </Svg>
    </View>
  );
}
