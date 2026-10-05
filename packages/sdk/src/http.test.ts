import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api.js';
import { ApiError } from './errors.js';
import { createHttp } from './http.js';

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

/** A fetch mock that records calls and answers from a queue (or a function). */
function mockFetch(respond: (call: Call, index: number) => Response | Promise<Response> | Error): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      init: { ...(init ?? {}), headers: (init?.headers ?? {}) as Record<string, string> },
    };
    calls.push(call);
    const r = await respond(call, calls.length - 1);
    if (r instanceof Error) throw r;
    return r;
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

describe('createHttp', () => {
  it('sends Authorization, X-Org-Id and Accept-Language and builds the query string', async () => {
    const { fetch, calls } = mockFetch(() => json({ items: [], nextCursor: null }));
    const http = createHttp({
      baseUrl: 'http://api.test/',
      fetchImpl: fetch,
      getToken: async () => 'tok-123',
      getOrgId: () => 'org-9',
      language: () => 'en',
    });
    const data = await http.get('/v1/supply', {
      limit: 20,
      county: "Murang'a",
      from: new Date('2026-01-02T00:00:00.000Z'),
      mine: true,
      skip: undefined,
      nothing: null,
    });
    expect(data).toEqual({ items: [], nextCursor: null });
    const call = calls[0]!;
    expect(call.url).toBe(
      "http://api.test/v1/supply?limit=20&county=Murang'a&from=2026-01-02T00%3A00%3A00.000Z&mine=true",
    );
    expect(call.init.method).toBe('GET');
    expect(call.init.headers.Authorization).toBe('Bearer tok-123');
    expect(call.init.headers['X-Org-Id']).toBe('org-9');
    expect(call.init.headers['Accept-Language']).toBe('en');
    expect(call.init.headers['Idempotency-Key']).toBeUndefined();
  });

  it('defaults the language to Kiswahili and omits auth headers when signed out', async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch, getToken: () => null });
    await http.get('/v1/produce');
    expect(calls[0]!.init.headers['Accept-Language']).toBe('sw');
    expect(calls[0]!.init.headers.Authorization).toBeUndefined();
    expect(calls[0]!.init.headers['X-Org-Id']).toBeUndefined();
  });

  it('adds a random Idempotency-Key to every write and keeps a caller-provided one', async () => {
    const { fetch, calls } = mockFetch(() => json({ id: 'o1' }, 201));
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch });
    await http.post('/v1/orders', { listingId: 'l1', quantity: 5 });
    await http.patch('/v1/me', { name: 'A' });
    await http.put('/v1/admin/settings/x', { value: 1 });
    await http.delete('/v1/devices/t');
    await http.post('/v1/orders', {}, { idempotencyKey: 'fixed-key' });

    const keys = calls.map((c) => c.init.headers['Idempotency-Key']);
    for (const k of keys.slice(0, 4)) expect(k).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(keys.slice(0, 4)).size).toBe(4);
    expect(keys[4]).toBe('fixed-key');
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe(JSON.stringify({ listingId: 'l1', quantity: 5 }));
    expect(calls[3]!.init.body).toBeUndefined();
  });

  it('parses the API error body into an ApiError', async () => {
    const { fetch } = mockFetch(() =>
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Some fields are missing or invalid',
            requestId: 'req-1',
            details: { issues: [{ path: 'quantity', message: 'Too small' }] },
          },
        },
        400,
      ),
    );
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch });
    const err = await http.post('/v1/orders', {}).catch((e: unknown) => e);
    expect(ApiError.is(err)).toBe(true);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('Some fields are missing or invalid');
    expect(e.requestId).toBe('req-1');
    expect(e.issues).toEqual([{ path: 'quantity', message: 'Too small' }]);
    expect(e.retryable).toBe(false);
    expect(e.isNetwork).toBe(false);
  });

  it('turns fetch failures into ApiError NETWORK with status 0', async () => {
    const { fetch } = mockFetch(() => new TypeError('Network request failed'));
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch });
    const err = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK');
    expect(err.isNetwork).toBe(true);
    expect(err.retryable).toBe(true);
  });

  it('times out slow requests with code TIMEOUT', async () => {
    const { fetch } = mockFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch, timeoutMs: 20 });
    const err = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('TIMEOUT');
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
  });

  it('calls onUnauthorized on 401 and still throws', async () => {
    const { fetch } = mockFetch(() =>
      json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue', requestId: 'r' } }, 401),
    );
    const onUnauthorized = vi.fn();
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch, onUnauthorized });
    await expect(http.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('handles Better Auth flat errors, plain-text bodies and empty bodies', async () => {
    const { fetch } = mockFetch((_c, i) => {
      if (i === 0)
        return json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 401);
      if (i === 1)
        return new Response('CON Karibu FarmGo', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (i === 2) return new Response(null, { status: 204 });
      return new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      });
    });
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch });
    await expect(http.post('/api/auth/sign-in/email', {})).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
    expect(await http.post('/webhooks/ussd', {})).toBe('CON Karibu FarmGo');
    expect(await http.delete('/v1/devices/x')).toBeNull();
    const err = (await http.get('/v1/me').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBe('INTERNAL');
    expect(err.retryable).toBe(true);
  });

  it('exposes status, headers and the Idempotent-Replay flag through request()', async () => {
    const { fetch } = mockFetch(() =>
      json({ id: 'o1' }, 201, { 'idempotent-replay': 'true', 'x-request-id': 'abc' }),
    );
    const http = createHttp({ baseUrl: 'http://api.test', fetchImpl: fetch });
    const res = await http.request<{ id: string }>('POST', '/v1/orders', { body: {} });
    expect(res.status).toBe(201);
    expect(res.data.id).toBe('o1');
    expect(res.idempotentReplay).toBe(true);
    expect(res.requestId).toBe('abc');
  });
});

describe('createApi', () => {
  it('maps namespaced methods to the right method, path and body', async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const api = createApi({ baseUrl: 'http://api.test', fetchImpl: fetch, getToken: () => 't' });

    await api.me.get();
    await api.orders.pay('ord 1', { phoneNumber: '0712345678' });
    await api.orders.cancel('o2', { reason: 'Changed plans' });
    await api.crates.get('QR/with/slashes');
    await api.devices.unregister('ExponentPushToken[abc]');
    await api.admin.settings.set('commissionBps', { value: 700 });
    await api.supply.list({ upcoming: true, limit: 5 });
    await api.demand.cancel('d1');
    await api.health.live();
    await api.webhooks.mpesaStk({ Body: {} }, 'secret');

    const seen = calls.map((c) => `${c.init.method} ${c.url.replace('http://api.test', '')}`);
    expect(seen).toEqual([
      'GET /v1/me',
      'POST /v1/orders/ord%201/pay',
      'POST /v1/orders/o2/cancel',
      'GET /v1/crates/QR%2Fwith%2Fslashes',
      'DELETE /v1/devices/ExponentPushToken%5Babc%5D',
      'PUT /v1/admin/settings/commissionBps',
      'GET /v1/supply?upcoming=true&limit=5',
      'PATCH /v1/demand/d1',
      'GET /health/live',
      'POST /webhooks/mpesa/stk?token=secret',
    ]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ phoneNumber: '0712345678' });
    expect(JSON.parse(calls[7]!.init.body as string)).toEqual({ status: 'CANCELLED' });
    // Health and webhooks are anonymous even when a token exists.
    expect(calls[8]!.init.headers.Authorization).toBeUndefined();
    expect(calls[9]!.init.headers.Authorization).toBeUndefined();
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer t');
  });
});
