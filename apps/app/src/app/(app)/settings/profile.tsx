import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSession } from '../../../data/session';
import { pickPhoto, uploadPhoto } from '../../../features/qa/upload';
import { api } from '../../../lib/api';
import { humanError } from '../../../lib/errors';
import { useTheme } from '../../../theme/theme';
import { Button } from '../../../ui/Button';
import { Avatar } from '../../../ui/Controls';
import { useDialog } from '../../../ui/overlays/Dialog';
import { useToast } from '../../../ui/overlays/Toast';
import { CountyPicker, SelectField } from '../../../ui/Pickers';
import { Pressable } from '../../../ui/Pressable';
import { Header, Screen } from '../../../ui/Screen';
import { Text } from '../../../ui/Text';
import { TextField } from '../../../ui/TextField';

/** Edit name, county and profile photo (PATCH /v1/me). */
export default function EditProfile() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const toast = useToast();
  const dialog = useDialog();
  const me = useSession((s) => s.me);
  const refreshMe = useSession((s) => s.refreshMe);
  const [name, setName] = useState(me?.user.name ?? '');
  const [county, setCounty] = useState<string | null>(me?.user.county ?? null);
  const [photo, setPhoto] = useState<{ key: string; uri: string } | null>(null);
  const [countyOpen, setCountyOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== (me?.user.name ?? '') || county !== (me?.user.county ?? null) || !!photo;

  const choosePhoto = async () => {
    const picked = await pickPhoto('library');
    if (picked === null) return;
    if (picked === 'denied') return toast.error(tr('qa.galleryDenied'));
    setUploading(true);
    try {
      setPhoto({ key: await uploadPhoto('avatars', picked), uri: picked.uri });
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (name.trim().length < 2) return setError(tr('editProfile.nameRequired'));
    setSaving(true);
    try {
      await api.patch('/v1/me', { name: name.trim(), county: county ?? undefined, image: photo?.key });
      await refreshMe();
      toast.success(tr('editProfile.saved'));
      router.back();
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: tr('editProfile.discardTitle'),
        message: tr('editProfile.discardBody'),
        confirmLabel: tr('editProfile.discard'),
        destructive: true,
      }))
    )
      return;
    router.back();
  };

  return (
    <Screen
      header={<Header title={tr('profile.editProfile')} onBack={leave} />}
      maxWidth={560}
      footer={
        <Button
          label={tr('common.saveChanges')}
          onPress={save}
          loading={saving}
          disabled={!dirty || uploading}
        />
      }
    >
      <View style={{ gap: 20, paddingTop: 8 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={choosePhoto}
            accessibilityLabel={tr('editProfile.changePhoto')}
            focusRadius={60}
            disabled={uploading}
          >
            <Avatar uri={photo?.uri ?? me?.user.imageUrl} name={name} size={96} />
          </Pressable>
          <Button
            label={uploading ? tr('common.loading') : tr('editProfile.changePhoto')}
            variant="ghost"
            size="sm"
            icon="camera"
            onPress={choosePhoto}
            loading={uploading}
          />
        </View>
        <TextField
          label={tr('editProfile.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          error={error}
          maxLength={120}
        />
        <SelectField
          label={tr('editProfile.county')}
          value={county}
          placeholder={tr('setup.countyPlaceholder')}
          onPress={() => setCountyOpen(true)}
          icon="location"
        />
        {me?.user.phoneNumber ? (
          <View style={{ gap: 4 }}>
            <Text variant="caption" tone="secondary">
              {tr('editProfile.phone')}
            </Text>
            <Text variant="body" numeric style={{ color: t.colors.text }}>
              {me.user.phoneNumber}
            </Text>
          </View>
        ) : null}
      </View>
      <CountyPicker
        visible={countyOpen}
        onClose={() => setCountyOpen(false)}
        value={county}
        onSelect={(c) => setCounty(c)}
      />
    </Screen>
  );
}
