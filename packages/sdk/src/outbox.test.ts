import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors.js';
import type { HttpClient, HttpMethod, RequestOptions } from './http.js';
import { createOutbox, memoryStorage, type OutboxSnapshot } from './outbox.js';

type Sent = { method: HttpMethod; path: string; opts?: RequestOptions };

/** Scripted `api.request`: each call takes the next result (a value to resolve, or an Error to throw). */
function fakeApi(script: (unknown | Error)[]) {
  const sent: Sent[] = [];
  let i = 0;
  const request = vi.fn(async (method: HttpMethod, path: string, opts?: RequestOptions) => {
    sent.push({ method, path, opts });
    const next = script[Math.min(i, script.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return { status: 201, data: next, headers: new Headers(), idempotentReplay: false, requestId: null };
  });
  return { api: { request } as unknown as Pick<HttpClient, 'request'>, sent, request };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

const apiErr = (status: number, code: string) => new ApiError({ status, code, message: code });

/** Manual timers: the outbox schedules with these so tests control backoff without fake globals. */
function manualTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const h = { fn, ms };
      pending.push(h);
      return h;
    },
    clearTimeout: (h: unknown) => {
      const idx = pending.indexOf(h as { fn: () => void; ms: number });
      if (idx >= 0) pending.splice(idx, 1);
    },
    pending,
    fire() {
      const h = pending.shift();
      h?.fn();
      return h?.ms;
    },
  };
}

describe('createOutbox', () => {
  it('persists a write with its idempotency key and replays it when online', async () => {
    const storage = memoryStorage();
    const { api, sent } = fakeApi([{ id: 'o1' }]);
    const onSent = vi.fn();
    const outbox = createOutbox({ storage, api, online: false, onSent });

    const item = await outbox.enqueue({
      method: 'POST',
      path: '/v1/orders/o1/confirm',
      body: undefined,
      meta: { kind: 'order.confirm' },
    });
    expect(item.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(outbox.pending()).toHaveLength(1);
    expect(JSON.parse(storage.dump()['farmgo.outbox']!)).toHaveLength(1);
    expect(sent).toHaveLength(0);

    outbox.setOnline(true);
    await flushMicrotasks();
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/v1/orders/o1/confirm',
        opts: { body: undefined, idempotencyKey: item.idempotencyKey },
      },
    ]);
    expect(outbox.pending()).toHaveLength(0);
    expect(storage.dump()['farmgo.outbox']).toBeUndefined();
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ id: item.id }), {
      status: 201,
      data: { id: 'o1' },
    });
  });

  it('replays in order and restores the queue from storage after a restart', async () => {
    const storage = memoryStorage();
    const first = createOutbox({ storage, api: fakeApi([]).api, online: false });
    await first.enqueue({ method: 'POST', path: '/a', body: { n: 1 } });
    await first.enqueue({ method: 'PATCH', path: '/b', body: { n: 2 } });
    await first.enqueue({ method: 'POST', path: '/c', body: { n: 3 } });

    // New process, same storage.
    const { api, sent } = fakeApi([{}, {}, {}]);
    const second = createOutbox({ storage, api });
    await second.load();
    expect(second.pending().map((i) => i.path)).toEqual(['/a', '/b', '/c']);
    await second.flush();
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /a', 'PATCH /b', 'POST /c']);
    expect(sent.map((s) => (s.opts?.body as { n: number } | undefined)?.n)).toEqual([1, 2, 3]);
    expect(second.pending()).toHaveLength(0);
  });

  it('stops on a 4xx, keeps the item as failed, surfaces it, and continues after dismiss', async () => {
    const storage = memoryStorage();
    const { api, sent } = fakeApi([apiErr(409, 'ORDER_INVALID_TRANSITION'), {}]);
    const onFailed = vi.fn();
    const snapshots: OutboxSnapshot[] = [];
    const outbox = createOutbox({ storage, api, online: false, onFailed });
    outbox.subscribe((s) => snapshots.push(s));

    const bad = await outbox.enqueue({ method: 'POST', path: '/v1/orders/x/confirm' });
    await outbox.enqueue({ method: 'POST', path: '/v1/orders/y/confirm' });
    outbox.setOnline(true);
    await flushMicrotasks();

    expect(sent).toHaveLength(1); // the second item waits behind the failure
    const snap = outbox.snapshot();
    expect(snap.failed?.id).toBe(bad.id);
    expect(snap.failed?.error).toMatchObject({ status: 409, code: 'ORDER_INVALID_TRANSITION' });
    expect(snap.pending).toBe(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.failed?.id).toBe(bad.id);
    // Persisted as failed, so a restart shows the same problem.
    expect(JSON.parse(storage.dump()['farmgo.outbox']!)[0].status).toBe('failed');

    await outbox.dismiss(bad.id);
    await flushMicrotasks();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.path).toBe('/v1/orders/y/confirm');
    expect(outbox.pending()).toHaveLength(0);
  });

  it('retries 5xx and network failures with exponential backoff, reusing the same key', async () => {
    const storage = memoryStorage();
    const timers = manualTimers();
    let now = 0;
    const { api, sent } = fakeApi([apiErr(0, 'NETWORK'), apiErr(503, 'INTERNAL'), { ok: true }]);
    const outbox = createOutbox({
      storage,
      api,
      backoff: { baseMs: 1000, maxMs: 60_000, jitter: false },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      now: () => now,
    });
    const item = await outbox.enqueue({ method: 'POST', path: '/v1/supply', body: { q: 1 } });
    await flushMicrotasks();

    expect(sent).toHaveLength(1);
    expect(outbox.pending()[0]).toMatchObject({ status: 'queued', attempts: 1, error: { code: 'NETWORK' } });
    expect(timers.pending.map((p) => p.ms)).toEqual([1000]);

    now = 1000;
    timers.fire();
    await flushMicrotasks();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.opts?.idempotencyKey).toBe(item.idempotencyKey);
    expect(outbox.pending()[0]).toMatchObject({ status: 'queued', attempts: 2, error: { status: 503 } });
    expect(timers.pending.map((p) => p.ms)).toEqual([2000]);

    now = 3000;
    timers.fire();
    await flushMicrotasks();
    expect(sent).toHaveLength(3);
    expect(sent[2]!.opts?.idempotencyKey).toBe(item.idempotencyKey);
    expect(outbox.pending()).toHaveLength(0);
    expect(storage.dump()['farmgo.outbox']).toBeUndefined();
  });

  it('waits for backoff to elapse before retrying and fires the scheduled retry', async () => {
    const storage = memoryStorage();
    const timers = manualTimers();
    let now = 0;
    const { api, sent } = fakeApi([apiErr(502, 'UPSTREAM'), { ok: true }]);
    const outbox = createOutbox({
      storage,
      api,
      backoff: { baseMs: 500, jitter: false },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      now: () => now,
    });
    await outbox.enqueue({ method: 'POST', path: '/x' });
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    expect(timers.pending).toHaveLength(1);

    // Flushing early does nothing but re-arm the timer.
    await outbox.flush();
    expect(sent).toHaveLength(1);

    now = 600;
    timers.fire();
    await flushMicrotasks();
    expect(sent).toHaveLength(2);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('marks an item failed after maxAttempts retryable failures', async () => {
    const storage = memoryStorage();
    let now = 0;
    const { api, sent } = fakeApi([apiErr(500, 'INTERNAL')]);
    const onFailed = vi.fn();
    const outbox = createOutbox({
      storage,
      api,
      maxAttempts: 3,
      backoff: { baseMs: 1, maxMs: 1, jitter: false },
      setTimeout: (fn) => {
        now += 5;
        queueMicrotask(fn);
        return 0;
      },
      clearTimeout: () => undefined,
      now: () => now,
      onFailed,
    });
    await outbox.enqueue({ method: 'POST', path: '/x' });
    for (let i = 0; i < 10; i++) await flushMicrotasks();
    expect(sent).toHaveLength(3);
    expect(outbox.snapshot().failed).toMatchObject({ status: 'failed', attempts: 3 });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('retry() puts a failed item back and sends it', async () => {
    const storage = memoryStorage();
    const { api, sent } = fakeApi([apiErr(403, 'FORBIDDEN'), { ok: true }]);
    const outbox = createOutbox({ storage, api });
    const item = await outbox.enqueue({ method: 'POST', path: '/x' });
    await flushMicrotasks();
    expect(outbox.snapshot().failed?.id).toBe(item.id);
    await outbox.retry(item.id);
    expect(sent).toHaveLength(2);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('subscribe delivers the current snapshot immediately and unsubscribes cleanly', async () => {
    const outbox = createOutbox({ storage: memoryStorage(), api: fakeApi([{}]).api, online: false });
    const seen: number[] = [];
    const off = outbox.subscribe((s) => seen.push(s.pending));
    expect(seen).toEqual([0]);
    await outbox.enqueue({ method: 'POST', path: '/x' });
    expect(seen.at(-1)).toBe(1);
    off();
    await outbox.clear();
    expect(seen.at(-1)).toBe(1);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('treats a crashed "sending" item as queued on reload', async () => {
    const storage = memoryStorage();
    await storage.set(
      'farmgo.outbox',
      JSON.stringify([
        {
          id: 'a',
          createdAt: 'x',
          method: 'POST',
          path: '/x',
          idempotencyKey: 'k',
          attempts: 1,
          status: 'sending',
        },
      ]),
    );
    const { api, sent } = fakeApi([{}]);
    const outbox = createOutbox({ storage, api });
    await outbox.load();
    expect(outbox.pending()[0]?.status).toBe('queued');
    await outbox.flush();
    expect(sent[0]?.opts?.idempotencyKey).toBe('k');
  });
});
