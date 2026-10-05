import type { PresignDto } from '@farmgo/contracts';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api } from '../../lib/api';

export type UploadBucket =
  | 'produce-photos'
  | 'qa-evidence'
  | 'proof-of-delivery'
  | 'kyc'
  | 'chat'
  | 'avatars';

export interface PickedPhoto {
  uri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Take or choose a photo. Returns null when the person cancels or refuses permission
 * (callers show their own message for `denied`).
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickedPhoto | 'denied' | null> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  const perm = useCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
    exif: false,
  };
  const res = useCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const mime = a.mimeType === 'image/png' || a.mimeType === 'image/webp' ? a.mimeType : 'image/jpeg';
  return { uri: a.uri, mimeType: mime };
}

async function putToStorage(
  bucket: UploadBucket,
  body: Blob | ArrayBuffer,
  contentType: string,
  size: number,
): Promise<string> {
  const p = await api.post<PresignDto>('/v1/uploads/presign', { bucket, contentType, size });
  const res = await fetch(p.url, { method: 'PUT', headers: p.headers, body: body as BodyInit });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return p.key;
}

/** Upload a local file (camera, gallery) and return its storage key. */
export async function uploadPhoto(bucket: UploadBucket, photo: PickedPhoto): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  return putToStorage(bucket, blob, photo.mimeType, blob.size);
}

/** Upload bytes built in the app (the signature PNG). */
export async function uploadBytes(
  bucket: UploadBucket,
  bytes: Uint8Array,
  contentType: 'image/png',
): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const body = Platform.OS === 'web' ? new Blob([copy], { type: contentType }) : copy.buffer;
  return putToStorage(bucket, body, contentType, bytes.byteLength);
}
