import type { Language } from '@farmgo/contracts';
import { ApiError, SDK_ERROR_CODES } from './errors.js';
import { joinUrl, type QueryParams, toQueryString } from './query.js';
import { randomUUID } from './uuid.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export const WRITE_METHODS: readonly HttpMethod[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

export type MaybePromise<T> = T | Promise<T>;
type Getter<T> = T | (() => MaybePromise<T>);

export interface HttpOptions {
  /** e.g. `https://api.farmgo.co.ke` or `http://localhost:4000` (no trailing slash needed). */
  baseUrl: string;
  /** Bearer token for `Authorization`. Return null/undefined when signed out. */
  getToken?: () => MaybePromise<string | null | undefined>;
  /** Organization the user is acting for (`X-Org-Id`), for members of several organizations. */
  getOrgId?: () => MaybePromise<string | null | undefined>;
  /** Called once per 401 response, before the ApiError is thrown. */
  onUnauthorized?: (err: ApiError) => void;
  /** Defaults to `globalThis.fetch`. Inject for tests or a custom transport. */
  fetchImpl?: typeof fetch;
  /** `Accept-Language`, a fixed value or a getter (`'en' | 'sw'`). Defaults to `sw`. */
  language?: Getter<Language | string | null | undefined>;
  /** Extra headers on every request (e.g. `origin` in tests, `x-app-version`). */
  headers?: Getter<Record<string, string> | undefined>;
  /** Abort requests after this long. Default 30 000 ms. `0` disables. */
  timeoutMs?: number;
  /** Generate idempotency keys. Default: random UUID. */
  idempotencyKey?: () => string;
}

export interface RequestOptions {
  query?: QueryParams | object;
  body?: unknown;
  headers?: Record<string, string>;
  /** Overrides the generated key on writes (the outbox passes the key it persisted). */
  idempotencyKey?: string;
  /** Send this body as-is (Blob, FormData, string) instead of JSON. */
  rawBody?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Skip the Authorization header even when a token exists. */
  anonymous?: boolean;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Headers;
  /** The API replayed a stored response for a repeated Idempotency-Key. */
  idempotentReplay: boolean;
  requestId: string | null;
}

export interface HttpClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  /** Full request with status and headers. */
  request<T = unknown>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<HttpResponse<T>>;
  /** Body only. */
  call<T = unknown>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, query?: QueryParams | object, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** Headers this client would send (auth, org, language, extras). Used by uploads. */
  authHeaders(): Promise<Record<string, string>>;
}

async function resolveGetter<T>(v: Getter<T> | undefined): Promise<T | undefined> {
  if (typeof v === 'function') return (v as () => MaybePromise<T>)();
  return v;
}

const DEFAULT_TIMEOUT = 30_000;

export function createHttp(options: HttpOptions): HttpClient {
  const fetchImpl: typeof fetch =
    options.fetchImpl ??
    ((...args) => {
      const f = globalThis.fetch;
      if (typeof f !== 'function') throw new Error('No fetch implementation: pass fetchImpl');
      return f(...args);
    });
  const newKey = options.idempotencyKey ?? randomUUID;

  async function authHeaders(anonymous = false): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json' };
    const lang = (await resolveGetter(options.language)) ?? 'sw';
    if (lang) h['Accept-Language'] = lang;
    if (!anonymous) {
      const token = await options.getToken?.();
      if (token) h.Authorization = `Bearer ${token}`;
    }
    const orgId = await options.getOrgId?.();
    if (orgId) h['X-Org-Id'] = orgId;
    const extra = await resolveGetter(options.headers);
    if (extra) Object.assign(h, extra);
    return h;
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = joinUrl(options.baseUrl, path) + toQueryString(opts.query);
    const headers = await authHeaders(opts.anonymous);
    if (opts.headers) Object.assign(headers, opts.headers);

    let body: BodyInit | undefined;
    if (opts.rawBody !== undefined) body = opts.rawBody;
    else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    if (WRITE_METHODS.includes(method) && !headers['Idempotency-Key']) {
      headers['Idempotency-Key'] = opts.idempotencyKey ?? newKey();
    }

    const timeoutMs = opts.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT;
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (controller) {
      const outer = opts.signal;
      if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
    }

    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: controller?.signal });
    } catch (cause) {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        throw new ApiError({
          status: 0,
          code: SDK_ERROR_CODES.TIMEOUT,
          message: `The request took longer than ${timeoutMs} ms`,
          cause,
        });
      }
      const message = cause instanceof Error ? cause.message : 'Network request failed';
      throw new ApiError({ status: 0, code: SDK_ERROR_CODES.NETWORK, message, cause });
    }
    if (timer) clearTimeout(timer);

    const requestId = res.headers.get('x-request-id');
    const text = await res.text();
    let data: unknown = null;
    if (text.length) {
      const type = res.headers.get('content-type') ?? '';
      try {
        data = JSON.parse(text);
      } catch (cause) {
        if (res.ok && type.includes('json')) {
          throw new ApiError({
            status: res.status,
            code: SDK_ERROR_CODES.BAD_RESPONSE,
            message: 'The server sent a response the app could not read',
            requestId: requestId ?? undefined,
            cause,
          });
        }
        // Plain text (USSD replies, proxies, HTML error pages).
        data = text;
      }
    }

    if (!res.ok) {
      const err = ApiError.fromResponse(res.status, data, requestId ?? undefined);
      if (res.status === 401) options.onUnauthorized?.(err);
      throw err;
    }
    return {
      status: res.status,
      data: data as T,
      headers: res.headers,
      idempotentReplay: res.headers.get('idempotent-replay') === 'true',
      requestId,
    };
  }

  const call = async <T>(method: HttpMethod, path: string, opts?: RequestOptions) =>
    (await request<T>(method, path, opts)).data;

  return {
    baseUrl: options.baseUrl,
    fetchImpl,
    request,
    call,
    get: (path, query, opts) => call('GET', path, { ...opts, query }),
    post: (path, body, opts) => call('POST', path, { ...opts, body }),
    patch: (path, body, opts) => call('PATCH', path, { ...opts, body }),
    put: (path, body, opts) => call('PUT', path, { ...opts, body }),
    delete: (path, opts) => call('DELETE', path, opts),
    authHeaders: () => authHeaders(false),
  };
}
