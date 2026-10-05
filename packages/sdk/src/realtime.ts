import type { ClientMessage, LocationPing, ServerMessage, WsErrorCode } from '@farmgo/contracts';
import { WS_CLOSE } from '@farmgo/contracts';
import type { MaybePromise } from './http.js';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeEvent<TData = unknown> {
  channel: string;
  type: string;
  data: TData;
  seq: number;
  ts: string;
}

export type EventHandler<TData = unknown> = (event: RealtimeEvent<TData>) => void;

/** Minimal WebSocket surface (browser, React Native and Node 22 all provide it). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface RealtimeOptions {
  /** `wss://api.farmgo.co.ke/ws` (or `ws://localhost:4000/ws`). `http(s)://` is converted. */
  url: string;
  /** Bearer token, sent as `?token=`. Return null when signed out: the client then stays closed. */
  getToken: () => MaybePromise<string | null | undefined>;
  /** Defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketCtor;
  /** App-level ping interval. Default 20 000 ms. */
  pingIntervalMs?: number;
  /** Close and reconnect when a pong is this late. Default 10 000 ms. */
  pongTimeoutMs?: number;
  /** Reconnect backoff: base doubled per attempt up to max, with ±50% jitter. Defaults 1 s and 30 s. */
  backoff?: { baseMs?: number; maxMs?: number; jitter?: boolean };
  /** The server refused the token (close code 4401). The client stops reconnecting until `connect()`. */
  onUnauthorized?: () => void;
  /** Protocol-level errors from the server (`op: 'error'`). */
  onError?: (err: { code: WsErrorCode; message?: string; channel?: string }) => void;
  /** Timer functions, for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface Observable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface Realtime {
  /** Open the socket (and keep it open with reconnects) until `close()`. */
  connect(): void;
  /** Close and stop reconnecting. Subscriptions are kept for the next `connect()`. */
  close(): void;
  /**
   * Listen to a channel (`order:{id}`, `demand:{county}`, ...). The server subscription is sent once
   * per channel (after the server's `hello`) and re-sent with `lastSeq` after every reconnect. Returns an unsubscribe function.
   */
  subscribe<TData = unknown>(channel: string, handler: EventHandler<TData>): () => void;
  /** Fires when the server could not replay a gap: refetch that channel's data over REST. */
  onResync(handler: (channel: string) => void): () => void;
  /** `connecting` | `open` | `closed`. */
  readonly status: Observable<RealtimeStatus>;
  /** Highest sequence seen per channel (persist it if you want catch-up across app restarts). */
  lastSeq(channel: string): number | undefined;
  /** Seed `lastSeq` values before `connect()` (e.g. from storage). */
  setLastSeq(channel: string, seq: number): void;
  /** Send a raw protocol message (drops it when not open; returns whether it was sent). */
  send(message: ClientMessage): boolean;
  /** Driver GPS ping over the socket. */
  sendLocation(ping: LocationPing): boolean;
  /** Channels auto-joined by the server for this user (from `hello`). */
  autoChannels(): string[];
}

const OPEN = 1;

export function createRealtime(opts: RealtimeOptions): Realtime {
  const schedule = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const unschedule = opts.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const pingIntervalMs = opts.pingIntervalMs ?? 20_000;
  const pongTimeoutMs = opts.pongTimeoutMs ?? 10_000;
  const baseMs = opts.backoff?.baseMs ?? 1_000;
  const maxMs = opts.backoff?.maxMs ?? 30_000;
  const jitter = opts.backoff?.jitter ?? true;

  const handlers = new Map<string, Set<EventHandler>>();
  const seqs = new Map<string, number>();
  const resyncHandlers = new Set<(channel: string) => void>();
  const statusListeners = new Set<(s: RealtimeStatus) => void>();
  let status: RealtimeStatus = 'closed';
  let socket: WebSocketLike | null = null;
  let wanted = false;
  let attempts = 0;
  let generation = 0;
  let reconnectTimer: unknown = null;
  let pingTimer: unknown = null;
  let pongTimer: unknown = null;
  let hello: string[] = [];
  // The server attaches its message handler after it sends `hello`; anything sent before is dropped.
  let ready = false;

  function setStatus(s: RealtimeStatus) {
    if (status === s) return;
    status = s;
    for (const l of statusListeners) l(s);
  }

  function wsUrl(token: string): string {
    const base = opts.url.replace(/^http/i, 'ws');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }

  function rawSend(msg: ClientMessage): boolean {
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  function clearTimers() {
    for (const t of [reconnectTimer, pingTimer, pongTimer]) if (t !== null) unschedule(t);
    reconnectTimer = pingTimer = pongTimer = null;
  }

  function schedulePing() {
    if (pingTimer !== null) unschedule(pingTimer);
    pingTimer = schedule(() => {
      pingTimer = null;
      if (!rawSend({ op: 'ping' })) return;
      if (pongTimer !== null) unschedule(pongTimer);
      pongTimer = schedule(() => {
        pongTimer = null;
        // No pong: the connection is dead even if the OS has not noticed. Reconnect.
        socket?.close(4000, 'pong timeout');
      }, pongTimeoutMs);
    }, pingIntervalMs);
  }

  function subscribeAll() {
    for (const channel of handlers.keys()) {
      const lastSeq = seqs.get(channel);
      rawSend(lastSeq === undefined ? { op: 'subscribe', channel } : { op: 'subscribe', channel, lastSeq });
    }
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer !== null) return;
    attempts += 1;
    const exp = Math.min(maxMs, baseMs * 2 ** (attempts - 1));
    const wait = jitter ? Math.round(exp * (0.5 + Math.random())) : exp;
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      void open();
    }, wait);
  }

  function handleMessage(raw: unknown) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.op) {
      case 'hello':
        hello = msg.channels;
        ready = true;
        subscribeAll();
        return;
      case 'pong':
        if (pongTimer !== null) unschedule(pongTimer);
        pongTimer = null;
        schedulePing();
        return;
      case 'event': {
        const ev: RealtimeEvent = {
          channel: msg.channel,
          type: msg.type,
          data: msg.data,
          seq: msg.seq,
          ts: msg.ts,
        };
        if (msg.type === 'resync') {
          for (const h of resyncHandlers) h(msg.channel);
        } else if (msg.seq > (seqs.get(msg.channel) ?? -1)) {
          seqs.set(msg.channel, msg.seq);
        }
        const hs = handlers.get(msg.channel);
        if (hs) for (const h of hs) h(ev);
        return;
      }
      case 'error':
        opts.onError?.({ code: msg.code, message: msg.message, channel: msg.channel });
        return;
      default:
        return; // subscribed / unsubscribed acks
    }
  }

  async function open() {
    if (!wanted || socket) return;
    const gen = ++generation;
    setStatus('connecting');
    const token = await opts.getToken();
    if (gen !== generation || !wanted) return;
    if (!token) {
      // Signed out: wait for connect() to be called again.
      wanted = false;
      setStatus('closed');
      return;
    }
    const Ctor = opts.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) throw new Error('No WebSocket implementation: pass WebSocket in createRealtime options');

    let ws: WebSocketLike;
    try {
      ws = new Ctor(wsUrl(token));
    } catch {
      setStatus('closed');
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      attempts = 0;
      setStatus('open');
      schedulePing();
    };
    ws.onmessage = (ev) => {
      if (socket !== ws) return;
      handleMessage(ev.data);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
    ws.onclose = (ev) => {
      if (socket !== ws) return;
      socket = null;
      ready = false;
      clearTimers();
      setStatus('closed');
      if (ev.code === WS_CLOSE.UNAUTHORIZED || ev.code === WS_CLOSE.FORBIDDEN) {
        wanted = false;
        opts.onUnauthorized?.();
        return;
      }
      scheduleReconnect();
    };
  }

  const statusObservable: Observable<RealtimeStatus> = {
    get: () => status,
    subscribe(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };

  return {
    connect() {
      if (wanted && (socket || reconnectTimer !== null)) return;
      wanted = true;
      attempts = 0;
      void open();
    },

    close() {
      wanted = false;
      generation += 1;
      clearTimers();
      const ws = socket;
      socket = null;
      ready = false;
      ws?.close(1000, 'client closed');
      setStatus('closed');
    },

    subscribe(channel, handler) {
      let set = handlers.get(channel);
      const first = !set;
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      set.add(handler as EventHandler);
      if (first && ready && socket?.readyState === OPEN) {
        const lastSeq = seqs.get(channel);
        rawSend(lastSeq === undefined ? { op: 'subscribe', channel } : { op: 'subscribe', channel, lastSeq });
      }
      return () => {
        const s = handlers.get(channel);
        if (!s) return;
        s.delete(handler as EventHandler);
        if (s.size === 0) {
          handlers.delete(channel);
          // Auto-joined channels stay joined server-side; unsubscribing is harmless either way.
          rawSend({ op: 'unsubscribe', channel });
        }
      };
    },

    onResync(handler) {
      resyncHandlers.add(handler);
      return () => {
        resyncHandlers.delete(handler);
      };
    },

    status: statusObservable,
    lastSeq: (channel) => seqs.get(channel),
    setLastSeq: (channel, seq) => {
      seqs.set(channel, seq);
    },
    send: rawSend,
    sendLocation: (ping) => rawSend({ op: 'location', ...ping }),
    autoChannels: () => [...hello],
  };
}
