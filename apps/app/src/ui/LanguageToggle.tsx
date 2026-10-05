import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { changeLanguage } from '../data/session';
import { useTheme } from '../theme/theme';
import { Pressable } from './Pressable';
import { Text } from './Text';

/** EN / SW switch, available before sign-in (Welcome, sign-in screens). */
export function LanguageToggle({ onDark }: { onDark?: boolean }) {
  const t = useTheme();
  const { i18n, t: tr } = useTranslation();
  const current = i18n.language === 'sw' ? 'sw' : 'en';
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={tr('common.language')}
      style={[
        styles.wrap,
        {
          backgroundColor: onDark ? 'rgba(255,255,255,0.16)' : t.colors.surface,
          borderColor: onDark ? 'transparent' : t.colors.line,
        },
      ]}
    >
      {(['en', 'sw'] as const).map((l) => {
        const active = current === l;
        return (
          <Pressable
            key={l}
            onPress={() => void changeLanguage(l)}
            haptics="selection"
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={l === 'en' ? 'English' : 'Kiswahili'}
            focusRadius={999}
            style={[styles.opt, active && { backgroundColor: t.colors.primary }]}
          >
            <Text
              variant="caption"
              weight="bold"
              style={{ color: active ? '#FFFFFF' : onDark ? '#FFFFFF' : t.colors.textSecondary }}
            >
              {l.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: 999, padding: 3, borderWidth: 1 },
  opt: {
    minWidth: 44,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
