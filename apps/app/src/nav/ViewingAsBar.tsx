import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../data/session';
import { useTheme } from '../theme/theme';
import { Icon } from '../ui/Icon';
import { Pressable } from '../ui/Pressable';
import { Text } from '../ui/Text';

/** Shown while an admin is viewing the app as another user: who, and the way back. */
export function ViewingAsBar() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const impersonating = useSession((s) => s.impersonating);
  const me = useSession((s) => s.me);
  const stop = useSession((s) => s.stopViewingAs);
  const [busy, setBusy] = useState(false);
  if (!impersonating || !me) return null;

  const back = async () => {
    setBusy(true);
    try {
      await stop();
      router.replace('/settings/view-as');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[styles.bar, { backgroundColor: t.colors.band, paddingTop: insets.top + 8 }]}
      accessibilityRole="alert"
    >
      <Icon name="eye" size={16} color="#FFFFFF" />
      <Text variant="caption" style={{ color: '#FFFFFF', flex: 1 }} numberOfLines={1}>
        {tr('viewAs.viewing', { name: me.user.name, role: tr(`roles.${me.user.role ?? 'user'}`) })}
      </Text>
      <Pressable
        onPress={back}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={tr('viewAs.back')}
        focusRadius={999}
        style={({ pressed }) => [styles.btn, { opacity: pressed || busy ? 0.7 : 1 }]}
      >
        <Text variant="caption" style={{ color: t.colors.band, fontWeight: '700' }}>
          {tr('viewAs.back')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  btn: { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
