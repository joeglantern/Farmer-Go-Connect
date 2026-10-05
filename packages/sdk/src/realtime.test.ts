import type { ServerMessage } from '@farmgo/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createRealtime, type RealtimeStatus, type WebSocketLike } from './realtime.js';

/** A scriptable WebSocket: tests open/close it and inject server messages. */
class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.closed = { code, reason };
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }
  // Test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  /** Open and send the server hello (subscriptions are only sent after hello). */
  ready(channels: string[] = ['user:u1']) {
    this.open();
    this.receive({ op: 'hello', userId: 'u1', channels, serverTime: 'now' });
  }
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function timers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => {
      const h = { fn, ms };
      pending.push(h);
      return h;
    },
    clearTimeout: (h: unknown) => {
      const i = pending.indexOf(h as { fn: () => void; ms: number });
      if (i >= 0) pending.splice(i, 1);
    },
    fire(predicate?: (t: { ms: number }) => boolean) {
      const i = predicate ? pending.findIndex(predicate) : 0;
      if (i < 0) return;
      const [h] = pending.splice(i, 1);
      h?.fn();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: Partial<Parameters<typeof createRealtime>[0]> = {}) {
  FakeSocket.instances = [];
  const t = timers();
  const statuses: RealtimeStatus[] = [];
  const rt = createRealtime({
    url: 'http://localhost:4000/ws',
    getToken: async () => 'tok',
    WebSocket: FakeSocket as unknown as new (url: string) => WebSocketLike,
    backoff: { baseMs: 1000, maxMs: 30_000, jitter: false },
    setTimeout: t.setTimeout,
    clearTimeout: t.clearTimeout,
    ...opts,
  });
  rt.status.subscribe((s) => statuses.push(s));
  return { rt, t, statuses, socket: () => FakeSocket.instances.at(-1)! };
}

describe('createRealtime', () => {
  it('connects with the token in the query, subscribes channels and tracks lastSeq', async () => {
    const { rt, statuses, socket } = setup();
    const handler = vi.fn();
    rt.subscribe('order:o1', handler);
    rt.connect();
    await tick();

    const ws = socket();
    expect(ws.url).toBe('ws://localhost:4000/ws?token=tok');
    expect(statuses).toEqual(['closed', 'connecting']);
    ws.open();
    expect(rt.status.get()).toBe('open');
    // Nothing is sent until the server says hello (its message handler is not attached before).
    expect(ws.sent).toEqual([]);
    ws.receive({ op: 'hello', userId: 'u1', channels: ['user:u1', 'org:g1'], serverTime: 'now' });
    expect(ws.sent).toEqual([{ op: 'subscribe', channel: 'order:o1' }]);
    expect(rt.autoChannels()).toEqual(['user:u1', 'org:g1']);

    ws.receive({
      op: 'event',
      channel: 'order:o1',
      type: 'order.status_changed',
      data: { to: 'CONFIRMED' },
      seq: 7,
      ts: 't',
    });
    ws.receive({ op: 'event', channel: 'order:o1', type: 'order.message', data: {}, seq: 8, ts: 't' });
    // Out-of-order duplicate does not move lastSeq backwards.
    ws.receive({ op: 'event', channel: 'order:o1', type: 'order.message', data: {}, seq: 5, ts: 't' });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      channel: 'order:o1',
      type: 'order.status_changed',
      seq: 7,
    });
    expect(rt.lastSeq('order:o1')).toBe(8);

    // Subscribing while open sends immediately; a second handler on the same channel does not.
    rt.subscribe('demand:Nairobi', vi.fn());
    const off = rt.subscribe('demand:Nairobi', vi.fn());
    expect(ws.sent.filter((m) => (m as { channel?: string }).channel === 'demand:Nairobi')).toHaveLength(1);
    off();
    expect(ws.sent.at(-1)).toEqual({ op: 'subscribe', channel: 'demand:Nairobi' });
  });

  it('reconnects with exponential backoff and resubscribes with lastSeq', async () => {
    const { rt, t, socket, statuses } = setup();
    rt.subscribe('order:o1', vi.fn());
    rt.subscribe('prices:Kiambu', vi.fn());
    rt.connect();
    await tick();
    const first = socket();
    first.ready();
    first.receive({ op: 'event', channel: 'order:o1', type: 'x', data: null, seq: 41, ts: 't' });

    first.serverClose(1006, 'connection lost');
    expect(rt.status.get()).toBe('closed');
    expect(t.pending.map((p) => p.ms)).toEqual([1000]);
    t.fire();
    await tick();
    const second = socket();
    expect(second).not.toBe(first);
    expect(rt.status.get()).toBe('connecting');

    // Fails again before opening: backoff doubles.
    second.serverClose(1006);
    expect(t.pending.map((p) => p.ms)).toEqual([2000]);
    t.fire();
    await tick();
    const third = socket();
    third.ready();
    expect(third.sent).toEqual([
      { op: 'subscribe', channel: 'order:o1', lastSeq: 41 },
      { op: 'subscribe', channel: 'prices:Kiambu' },
    ]);
    expect(statuses.filter((s) => s === 'open')).toHaveLength(2);

    // A successful open resets the backoff.
    third.serverClose(1006);
    expect(t.pending.map((p) => p.ms)).toEqual([1000]);
  });

  it('emits resync when the server could not replay a gap, and does not move lastSeq', () => {
    const { rt, socket } = setup();
    const events = vi.fn();
    const resync = vi.fn();
    rt.setLastSeq('order:o1', 10);
    rt.subscribe('order:o1', events);
    rt.onResync(resync);
    rt.connect();
    return tick().then(() => {
      const ws = socket();
      ws.ready();
      expect(ws.sent).toEqual([{ op: 'subscribe', channel: 'order:o1', lastSeq: 10 }]);
      ws.receive({ op: 'event', channel: 'order:o1', type: 'resync', data: null, seq: 10, ts: 't' });
      expect(resync).toHaveBeenCalledWith('order:o1');
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'resync' }));
      expect(rt.lastSeq('order:o1')).toBe(10);
    });
  });

  it('pings every 20 s, and closes the socket when the pong is late', async () => {
    const { rt, t, socket } = setup();
    rt.connect();
    await tick();
    const ws = socket();
    ws.open();
    expect(t.pending.map((p) => p.ms)).toEqual([20_000]);
    t.fire();
    expect(ws.sent).toEqual([{ op: 'ping' }]);
    expect(t.pending.map((p) => p.ms)).toEqual([10_000]); // pong timeout armed
    ws.receive({ op: 'pong' });
    expect(t.pending.map((p) => p.ms)).toEqual([20_000]); // next ping armed

    t.fire();
    expect(ws.sent).toHaveLength(2);
    t.fire(); // pong timeout: the socket is closed and a reconnect is scheduled
    expect(ws.closed?.code).toBe(4000);
    expect(rt.status.get()).toBe('closed');
    expect(t.pending.map((p) => p.ms)).toEqual([1000]);
  });

  it('stops reconnecting on 4401 and reports onUnauthorized; close() stops everything', async () => {
    const onUnauthorized = vi.fn();
    const { rt, t, socket } = setup({ onUnauthorized });
    rt.connect();
    await tick();
    socket().serverClose(4401, 'unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.pending).toHaveLength(0);
    expect(rt.status.get()).toBe('closed');

    rt.connect();
    await tick();
    const ws = socket();
    ws.open();
    rt.close();
    expect(ws.closed?.code).toBe(1000);
    expect(t.pending).toHaveLength(0);
    expect(rt.status.get()).toBe('closed');
  });

  it('stays closed without a token and forwards protocol errors and location pings', async () => {
    const onError = vi.fn();
    const { rt, socket } = setup({ getToken: async () => null, onError });
    rt.connect();
    await tick();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(rt.status.get()).toBe('closed');

    const live = setup({ onError });
    live.rt.connect();
    await tick();
    const ws = live.socket();
    expect(live.rt.sendLocation({ routeId: 'r1', lat: -1.29, lng: 36.8 })).toBe(false); // not open yet
    ws.open();
    expect(live.rt.sendLocation({ routeId: 'r1', lat: -1.29, lng: 36.8 })).toBe(true);
    expect(ws.sent.at(-1)).toEqual({ op: 'location', routeId: 'r1', lat: -1.29, lng: 36.8 });
    ws.receive({ op: 'error', code: 'FORBIDDEN_CHANNEL', channel: 'org:other' });
    expect(onError).toHaveBeenCalledWith({
      code: 'FORBIDDEN_CHANNEL',
      message: undefined,
      channel: 'org:other',
    });
    void socket;
  });
});
