import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { useSession } from '../../data/session';
import i18n from '../../i18n';
import { ApiError } from '../../lib/api';
import { API_URL } from '../../lib/config';

/**
 * GET /v1/me/export (B18) as farmgo-export-YYYY-MM-DD.json: a browser download on web, the
 * share sheet on phones. Throws ApiError on failure so callers can show humanError().
 */
export async function downloadMyData(): Promise<void> {
  const token = useSession.getState().token;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/me/export`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': i18n.language === 'sw' ? 'sw' : 'en',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', i18n.t('common.errorBody'));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? i18n.t('common.errorBody'),
    );
  }
  const name = `farmgo-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS !== 'web') {
    // Phones: save to the cache, then hand it to the share sheet (Files, Drive, email...).
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(await res.text());
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: name,
        UTI: 'public.json',
      });
    }
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
