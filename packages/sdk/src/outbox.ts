import { ApiError } from './errors.js';
import type { HttpClient, HttpMethod, MaybePromise } from './http.js';
import { randomUUID } from './uuid.js';

/**
 * Key-value storage the app provides: MMKV, AsyncStorage, localStorage... Values are strings.
 * Methods may be sync or async.
 */
export interface OutboxStorage {
  get(key: string): MaybePromise<string | null | undefined>;
  set(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

/** Adapter for `@react-native-async-storage/async-storage` and anything with the same shape. */
export function asyncStorageAdapter(s: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}): OutboxStorage {
  return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
}

/** Adapter for `react-native-mmkv` (`getString/set/delete`) and `localStorage` (`getItem/setItem/removeItem`). */
export function syncStorageAdapter(
  s:
    | {
        getString(key: string): string | undefined;
        set(key: string, value: string): void;
        delete(key: string): void;
      }
    | {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
      },
): OutboxStorage {
  if ('getString' in s)
    return { get: (k) => s.getString(k), set: (k, v) => s.set(k, v), remove: (k) => s.delete(k) };
  return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
}

/** In-memory storage for tests and the web preview. */
export function memoryStorage(): OutboxStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
    },
    remove: (k) => {
      m.delete(k);
    },
    dump: () => Object.fromEntries(m),
  };
}

export type OutboxItemStatus = 'queued' | 'sending' | 'failed';

export interface OutboxItem<TBody = unknown> {
  id: string;
  createdAt: string;
  method: HttpMethod;
  path: string;
  body?: TBody;
  /** Sent as `Idempotency-Key`; the API replays the first response for repeats. */
  idempotencyKey: string;
  /** Free-form tag for the UI ("Waiting to send" chips), e.g. `{ kind: 'order.confirm', orderId }`. */
  meta?: Record<string, unknown>;
  attempts: number;
  status: OutboxItemStatus;
  /** Last error, kept for failed items and between retries. */
  error?: { status: number; code: string; message: string; requestId?: string; details?: unknown };
  nextAttemptAt?: string;
}

export interface OutboxSnapshot {
  items: OutboxItem[];
  /** Items still waiting or retrying (excludes `failed`). */
  pending: number;
  flushing: boolean;
  online: boolean;
  /** The item at the head that stopped the queue with a 4xx, if any. */
  failed: OutboxItem | null;
}

export interface EnqueueInput<TBody = unknown> {
  method: HttpMethod;
  path: string;
  body?: TBody;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
}

export interface OutboxOptions {
  storage: OutboxStorage;
  /** `api.http` from `createApi`, or anything with the same `request` method. */
  api: Pick<HttpClient, 'request'>;
  /** Storage key. Default `farmgo.outbox`. Use one per signed-in user if several share a device. */
  key?: string;
  /** Start online (default true). Call `setOnline` from NetInfo / `navigator.onLine`. */
  online?: boolean;
  /** Backoff for 5xx/network: base delay, doubled per attempt up to max. Defaults 1 s and 60 s. */
  backoff?: { baseMs?: number; maxMs?: number; jitter?: boolean };
  /** Give up on an item after this many retryable failures (default 20). It then becomes `failed`. */
  maxAttempts?: number;
  /** Called with each successful replay (e.g. to invalidate queries). */
  onSent?: (item: OutboxItem, response: { status: number; data: unknown }) => void;
  /** Called when an item fails for good (4xx, or out of attempts). */
  onFailed?: (item: OutboxItem, error: ApiError) => void;
  /** Time source, for tests. */
  now?: () => number;
  /** Scheduler, for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface Outbox {
  /** Load persisted items. Safe to call more than once. */
  load(): Promise<void>;
  /** Persist a write and try to send it now if online. Resolves once persisted, not once sent. */
  enqueue<TBody = unknown>(input: EnqueueInput<TBody>): Promise<OutboxItem<TBody>>;
  /** Replay queued items in order. Resolves when the queue is empty, blocked or waiting for backoff. */
  flush(): Promise<void>;
  /** Items waiting, retrying or failed (oldest first). */
  pending(): OutboxItem[];
  snapshot(): OutboxSnapshot;
  subscribe(listener: (s: OutboxSnapshot) => void): () => void;
  setOnline(online: boolean): void;
  /** Drop a failed (or queued) item. The queue continues with the next one. */
  dismiss(id: string): Promise<void>;
  /** Put a failed item back in the queue and flush. */
  retry(id: string): Promise<void>;
  /** Drop everything (sign-out). */
  clear(): Promise<void>;
  /** Cancel timers. */
  stop(): void;
}

const DEFAULT_KEY = 'farmgo.outbox';

export function createOutbox(opts: OutboxOptions): Outbox {
  const key = opts.key ?? DEFAULT_KEY;
  const now = opts.now ?? Date.now;
  const schedule = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const unschedule = opts.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const baseMs = opts.backoff?.baseMs ?? 1_000;
  const maxMs = opts.backoff?.maxMs ?? 60_000;
  const jitter = opts.backoff?.jitter ?? true;
  const maxAttempts = opts.maxAttempts ?? 20;

  let items: OutboxItem[] = [];
  let loaded = false;
  let online = opts.online ?? true;
  let flushing = false;
  let flushAgain = false;
  let timer: unknown = null;
  const listeners = new Set<(s: OutboxSnapshot) => void>();

  const snapshot = (): OutboxSnapshot => ({
    items: items.map((i) => ({ ...i })),
    pending: items.filter((i) => i.status !== 'failed').length,
    flushing,
    online,
    failed: items[0]?.status === 'failed' ? { ...items[0] } : null,
  });

  const notify = () => {
    const s = snapshot();
    for (const l of listeners) l(s);
  };

  async function persist() {
    if (items.length === 0) await opts.storage.remove(key);
    else await opts.storage.set(key, JSON.stringify(items));
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    const raw = await opts.storage.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OutboxItem[];
        if (Array.isArray(parsed)) {
          // A crash while "sending" leaves the item queued; the idempotency key makes the retry safe.
          items = parsed.map((i) => (i.status === 'sending' ? { ...i, status: 'queued' } : i));
        }
      } catch {
        items = [];
      }
    }
    notify();
  }

  function clearTimer() {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  }

  function delayFor(attempts: number): number {
    const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
    if (!jitter) return exp;
    // ±50% jitter so many phones coming back online do not retry in lockstep.
    return Math.round(exp * (0.5 + Math.random()));
  }

  async function flush(): Promise<void> {
    await load();
    if (flushing) {
      flushAgain = true;
      return;
    }
    if (!online) return;
    clearTimer();
    flushing = true;
    notify();
    try {
      while (online) {
        const head = items[0];
        if (!head) break;
        if (head.status === 'failed') break;
        if (head.nextAttemptAt && Date.parse(head.nextAttemptAt) > now()) {
          const wait = Date.parse(head.nextAttemptAt) - now();
          timer = schedule(() => {
            timer = null;
            void flush();
          }, wait);
          break;
        }

        head.status = 'sending';
        head.attempts += 1;
        notify();
        try {
          const res = await opts.api.request(head.method, head.path, {
            body: head.body,
            idempotencyKey: head.idempotencyKey,
          });
          items = items.filter((i) => i.id !== head.id);
          await persist();
          notify();
          opts.onSent?.(head, { status: res.status, data: res.data });
        } catch (err) {
          const apiErr =
            err instanceof ApiError
              ? err
              : new ApiError({
                  status: 0,
                  code: 'NETWORK',
                  message: (err as Error)?.message ?? 'Failed',
                  cause: err,
                });
          head.error = {
            status: apiErr.status,
            code: apiErr.code,
            message: apiErr.message,
            requestId: apiErr.requestId,
            details: apiErr.details,
          };
          if (apiErr.retryable && head.attempts < maxAttempts) {
            head.status = 'queued';
            const wait = delayFor(head.attempts);
            head.nextAttemptAt = new Date(now() + wait).toISOString();
            await persist();
            notify();
            if (online) {
              timer = schedule(() => {
                timer = null;
                void flush();
              }, wait);
            }
          } else {
            head.status = 'failed';
            head.nextAttemptAt = undefined;
            await persist();
            notify();
            opts.onFailed?.(head, apiErr);
          }
          break;
        }
      }
    } finally {
      flushing = false;
      notify();
      if (flushAgain) {
        flushAgain = false;
        void flush();
      }
    }
  }

  return {
    load,

    async enqueue<TBody = unknown>(input: EnqueueInput<TBody>) {
      await load();
      const item: OutboxItem = {
        id: randomUUID(),
        createdAt: new Date(now()).toISOString(),
        method: input.method,
        path: input.path,
        body: input.body,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
        meta: input.meta,
        attempts: 0,
        status: 'queued',
      };
      items.push(item);
      await persist();
      notify();
      if (online) void flush();
      return item as OutboxItem<TBody>;
    },

    flush,
    pending: () => items.map((i) => ({ ...i })),
    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    setOnline(value) {
      if (online === value) return;
      online = value;
      if (!online) clearTimer();
      notify();
      if (online) void flush();
    },

    async dismiss(id) {
      await load();
      items = items.filter((i) => i.id !== id);
      await persist();
      notify();
      if (online) void flush();
    },

    async retry(id) {
      await load();
      const item = items.find((i) => i.id === id);
      if (!item) return;
      item.status = 'queued';
      item.attempts = 0;
      item.nextAttemptAt = undefined;
      await persist();
      notify();
      await flush();
    },

    async clear() {
      clearTimer();
      items = [];
      await persist();
      notify();
    },

    stop: clearTimer,
  };
}
