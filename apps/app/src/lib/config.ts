import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL for devices on the network (a phone cannot reach
 * "localhost" on your computer). The Android emulator reaches the host at 10.0.2.2.
 */
function defaultApiUrl() {
  if (Platform.OS === 'android' && !Constants.isDevice) return 'http://10.0.2.2:4000';
  const hostUri = Constants.expoConfig?.hostUri; // e.g. 192.168.1.20:8081 when running in Expo Go
  if (Platform.OS !== 'web' && hostUri) return `http://${hostUri.split(':')[0]}:4000`;
  return 'http://localhost:4000';
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl()).replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

/**
 * Support and legal links. Set these per environment (EXPO_PUBLIC_*); rows that need a value
 * that is not configured are hidden rather than pointing somewhere wrong.
 */
export const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? null;
export const SUPPORT_WHATSAPP = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? null;
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? null;
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL ?? null;
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? null;
