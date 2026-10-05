import { ActivityIndicator, Pressable, Text, useColorScheme, View } from 'react-native';
import i18n from '../../i18n';
import { palette } from '../../theme/tokens';
import { LeafMark } from './Logo';

/**
 * Drawn before fonts, theme and session exist (so plain React Native only). Replaces a blank
 * screen while the app starts, and is the last-resort crash screen.
 */
export function BootScreen({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#0A1510' : '#F4F7F3';
  const fg = dark ? '#E7F0E9' : palette.green[900];
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 20,
      }}
    >
      <LeafMark size={72} />
      {error ? (
        <>
          <Text style={{ color: fg, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
            {i18n.t('common.errorTitle')}
          </Text>
          <Text style={{ color: fg, opacity: 0.75, fontSize: 15, textAlign: 'center', maxWidth: 320 }}>
            {i18n.t('common.crashBody')}
          </Text>
          {onRetry ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              style={({ pressed }) => ({
                backgroundColor: pressed ? palette.green[800] : palette.green[700],
                paddingHorizontal: 28,
                paddingVertical: 14,
                borderRadius: 999,
              })}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                {i18n.t('common.retry')}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <ActivityIndicator
          color={dark ? '#7FC593' : palette.green[700]}
          accessibilityLabel={i18n.t('common.loading')}
        />
      )}
    </View>
  );
}
