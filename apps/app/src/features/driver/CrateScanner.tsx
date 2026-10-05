import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/theme';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/Pressable';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';

/**
 * QR scanner for crate codes. Camera on phones; typed entry everywhere (web, a scratched
 * label, or camera refused). Calls onCode once per distinct code.
 */
export function CrateScanner({ onCode, busy }: { onCode: (code: string) => void; busy?: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [perm, request] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const last = useRef<{ code: string; at: number } | null>(null);
  const native = Platform.OS !== 'web';

  const handle = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    const now = Date.now();
    if (last.current && last.current.code === code && now - last.current.at < 2500) return;
    last.current = { code, at: now };
    haptic('success');
    onCode(code);
  };

  return (
    <View style={{ gap: 16 }}>
      {native &&
        (perm?.granted ? (
          <View style={[styles.camera, { borderRadius: t.radius.lg, backgroundColor: '#000' }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : (r) => handle(r.data)}
            />
            <View pointerEvents="none" style={styles.frameWrap}>
              <View style={[styles.frame, { borderColor: '#FFFFFF' }]} />
              <Text variant="callout" style={{ color: '#FFFFFF', marginTop: 14 }}>
                {tr('driver.pointAtCode')}
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[styles.permission, { backgroundColor: t.colors.primaryTint, borderRadius: t.radius.lg }]}
          >
            <Icon name="camera" size={34} color={t.colors.primary} weight="duotone" />
            <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 300 }}>
              {perm?.canAskAgain === false ? tr('driver.cameraBlocked') : tr('driver.cameraWhy')}
            </Text>
            {perm?.canAskAgain !== false && (
              <Button
                label={tr('driver.allowCamera')}
                size="md"
                fullWidth={false}
                icon="camera"
                onPress={() => void request()}
              />
            )}
          </View>
        ))}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <TextField
          containerStyle={{ flex: 1 }}
          label={native ? tr('driver.orTypeCode') : tr('driver.typeCode')}
          placeholder="FGC-XXXX-XXXXX"
          value={manual}
          onChangeText={setManual}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            handle(manual);
            setManual('');
          }}
        />
        <Button
          label={tr('driver.addCode')}
          size="md"
          fullWidth={false}
          disabled={!manual.trim()}
          loading={busy}
          onPress={() => {
            handle(manual);
            setManual('');
          }}
          style={{ marginBottom: 2 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { height: 280, overflow: 'hidden' },
  frameWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: 190, height: 190, borderWidth: 3, borderRadius: 20 },
  permission: { alignItems: 'center', gap: 12, padding: 24 },
});
