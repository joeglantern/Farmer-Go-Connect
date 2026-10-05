import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/theme';
import { Icon } from '../../ui/Icon';
import { Pressable } from '../../ui/Pressable';
import { Text } from '../../ui/Text';
import { encodeGrayPng, rasterise, type Stroke } from './png';

const OUT_W = 600;
const OUT_H = 240;

export interface SignatureHandle {
  isEmpty: () => boolean;
  toPng: () => Uint8Array | null;
}

const toPath = (s: Stroke) =>
  s.length === 1 ? `M ${s[0]!.x} ${s[0]!.y} l 0.1 0.1` : `M ${s.map((p) => `${p.x} ${p.y}`).join(' L ')}`;

/**
 * Recipient signature, drawn with a finger, stylus or mouse. The parent reads the drawing as
 * a PNG through `onChange` (null when cleared).
 */
export function SignaturePad({
  onChange,
  height = 180,
}: {
  onChange: (png: Uint8Array | null) => void;
  height?: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [strokes, setStrokesState] = useState<Stroke[]>([]);
  // Mirror of `strokes` so gesture callbacks read the latest drawing without state updaters.
  const all = useRef<Stroke[]>([]);
  const size = useRef({ w: 1, h: 1 });
  const current = useRef<Stroke>([]);

  const setStrokes = (next: Stroke[]) => {
    all.current = next;
    setStrokesState(next);
  };

  const commit = (next: Stroke[]) => {
    setStrokes(next);
    onChange(
      next.length
        ? encodeGrayPng(rasterise(next, size.current.w, size.current.h, OUT_W, OUT_H), OUT_W, OUT_H)
        : null,
    );
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      current.current = [{ x: e.x, y: e.y }];
      setStrokes([...all.current, current.current]);
    })
    .onUpdate((e) => {
      current.current = [...current.current, { x: e.x, y: e.y }];
      setStrokes([...all.current.slice(0, -1), current.current]);
    })
    .onFinalize(() => commit(all.current));

  return (
    <View style={{ gap: 8 }}>
      <View
        onLayout={(e: LayoutChangeEvent) => {
          size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        }}
        accessible
        accessibilityLabel={tr('driver.signatureArea')}
        style={[
          styles.pad,
          { height, borderColor: t.colors.lineStrong, borderRadius: t.radius.md, backgroundColor: '#FFFFFF' },
        ]}
      >
        <GestureDetector gesture={pan}>
          <View style={StyleSheet.absoluteFill}>
            <Svg width="100%" height="100%">
              {strokes.map((s, i) => (
                <Path
                  // biome-ignore lint/suspicious/noArrayIndexKey: strokes are append-only, so the index is a stable id
                  key={i}
                  d={toPath(s)}
                  stroke="#0D2418"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
            </Svg>
          </View>
        </GestureDetector>
        {strokes.length === 0 && (
          <View pointerEvents="none" style={styles.hint}>
            <Icon name="signature" size={26} color="#9AA89E" />
            <Text variant="callout" style={{ color: '#667a6e' }}>
              {tr('driver.signHere')}
            </Text>
          </View>
        )}
        <View pointerEvents="none" style={[styles.line, { backgroundColor: '#CBD7CE' }]} />
      </View>
      <Pressable
        onPress={() => commit([])}
        disabled={strokes.length === 0}
        accessibilityLabel={tr('driver.clearSignature')}
        style={{
          alignSelf: 'flex-end',
          paddingVertical: 6,
          paddingHorizontal: 4,
          opacity: strokes.length ? 1 : 0.4,
        }}
        focusRadius={6}
      >
        <Text variant="calloutStrong" tone="brand">
          {tr('driver.clearSignature')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { borderWidth: 1.5, borderStyle: 'dashed', overflow: 'hidden' },
  hint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  line: { position: 'absolute', left: 24, right: 24, bottom: 36, height: 1 },
});
