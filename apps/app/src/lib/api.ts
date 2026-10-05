import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import i18n from '../i18n';
import { API_URL } from './config';

/**
 * Minimal HTTP layer. The typed `@farmgo/sdk` (ticket 002) replaces the internals of
 * `request` when it lands; screens only use the hooks in src/data, so they do not change.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

let tokenGetter: () => string | null = () => null;
let orgGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => undefined;

export function configureApi(opts: {
  getToken: () => string | null;
  getOrgId?: () => string | null;
  onUnauthorized?: () => void;
}) {
  tokenGetter = opts.getToken;
  orgGetter = opts.getOrgId ?? (() => null);
  onUnauthorized = opts.onUnauthorized ?? (() => undefined);
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Reuse a key when retrying the same logical write (offline outbox). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Return the raw Response headers too (auth flows need set-auth-token). */
  raw?: boolean;
  /** Give up after this long (ms). A request that never answers must not hang a screen. */
  timeoutMs?: number;
  /** Send this bearer token instead of the signed-in one (admin calls while viewing as someone). */
  asToken?: string | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function qs(query?: Query) {
  if (!query) return '';
  const p = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
}

/** The app's deep-link scheme, as listed in the API's trusted origins (MOBILE_SCHEME). */
const APP_ORIGIN = 'farmgo://';

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': i18n.language === 'sw' ? 'sw' : 'en',
  };
  const token = opts.asToken ?? tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;
  const org = orgGetter();
  if (org) headers['X-Org-Id'] = org;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? Crypto.randomUUID();
  // Phones send no Origin header. Better Auth's CSRF check rejects that as soon as a session
  // cookie is present, so identify the app by its scheme (trusted by the Expo plugin).
  if (Platform.OS !== 'web') headers['expo-origin'] = APP_ORIGIN;

  // Abort on the caller's signal or on timeout, whichever comes first.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs(opts.query)}`, {
      method,
      headers,
      // Auth is the bearer token; never send or store cookies.
      credentials: 'omit',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' && !timedOut) throw err;
    throw new ApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK', i18n.t('common.errorBody'));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const e =
      (json as {
        error?: { code?: string; message?: string; requestId?: string; details?: unknown };
        code?: string;
        message?: string;
      }) ?? {};
    const code = e.error?.code ?? e.code ?? `HTTP_${res.status}`;
    const message = e.error?.message ?? e.message ?? i18n.t('auth.errors.generic');
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, code, message, e.error?.requestId, e.error?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
