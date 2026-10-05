# @farmgo/sdk

Typed client for the FarmGo Connect API, used by the Expo app (Android, iOS, web). It depends only on
`@farmgo/contracts` and `zod`, and uses nothing from Node: `fetch`, `WebSocket`, `URL` and timers only, so
it runs in React Native and the browser.

What is in the box:

| Piece | Entry point | Notes |
|---|---|---|
| HTTP client | `createApi(options)` | One namespaced method per API path (see `ENDPOINTS.md`). Sends `Authorization: Bearer`, `X-Org-Id`, `Accept-Language` and an `Idempotency-Key` on every write. Throws `ApiError`. |
| Offline outbox | `createOutbox({ storage, api })` | Persists writes while offline, replays them in order, stops on 4xx, retries 5xx and network errors with backoff. |
| Realtime | `createRealtime({ url, getToken })` | WebSocket client with reconnect, per-channel `lastSeq` catch-up, ping every 20 s and `resync` events. |
| Uploads | `uploadFile(api, { bucket, uri, contentType })` | Presign, PUT to storage, return the object key. |
| Money | `formatKes`, `parseKesInput`, `applyBps`, ... | Integer KES cents in, strings out. No floats. |
| Dates | `toIsoDay`, `daysBetween`, `relativeDay`, `weekStart`, ... | ISO 8601 with Nairobi calendar days. |

## Usage

```ts
import { ApiError, createApi, createOutbox, createRealtime, formatKes, syncStorageAdapter, uploadFile } from '@farmgo/sdk';
import { channels } from '@farmgo/contracts';

const api = createApi({
  baseUrl: 'https://api.farmgo.co.ke',
  getToken: () => session.token,          // from the Better Auth client
  getOrgId: () => activeOrgId,            // optional, for members of several organizations
  language: () => i18n.language,          // 'en' | 'sw'
  onUnauthorized: () => signOut(),
});

const me = await api.me.get();
const listings = await api.supply.list({ county: 'Kiambu', upcoming: true, limit: 20 });
const order = await api.orders.create({ listingId: listings.items[0].id, quantity: 20 });
const pay = await api.orders.pay(order.id, { phoneNumber: '0712345678' });   // M-Pesa STK push
console.log(formatKes(order.total));                                         // "KES 1,600"

const outbox = createOutbox({ storage: syncStorageAdapter(mmkv), api: api.http });
outbox.subscribe(({ pending, failed }) => setBadge(pending, failed));        // "Waiting to send" chips
await outbox.enqueue({ method: 'POST', path: `/v1/orders/${order.id}/confirm`, meta: { orderId: order.id } });
NetInfo.addEventListener((s) => outbox.setOnline(!!s.isConnected));

const rt = createRealtime({ url: 'wss://api.farmgo.co.ke/ws', getToken: () => session.token });
rt.subscribe(channels.order(order.id), (e) => queryClient.invalidateQueries({ queryKey: ['order', order.id] }));
rt.onResync((channel) => refetchEverythingFor(channel));
rt.connect();

const { key } = await uploadFile(api, { bucket: 'produce-photos', uri: photo.uri, contentType: 'image/jpeg' });
await api.supply.update(listing.id, { photos: [key] });

try { await api.orders.cancel(order.id, { reason: 'Menu changed' }); }
catch (err) { if (ApiError.is(err) && err.code === 'ORDER_INVALID_TRANSITION') toast(err.message); }
```

## Details

**Types.** Request bodies and query strings are typed from the Zod schemas in `@farmgo/contracts`
through `Input<typeof Schema>`: optional where the schema has a default, and `Date | string` wherever the
API coerces a date. Response types live in `src/types.ts` as hand-written interfaces matching the JSON
(dates as ISO strings, Decimals as numbers). When the Backend adds `XxxDto` schemas to contracts (item B01),
swap the matching interface for `z.infer<typeof XxxDto>`.

**Errors.** Every failure is an `ApiError { status, code, message, requestId?, details? }`. Network failures
have `status: 0` and `code: 'NETWORK'`; timeouts (default 30 s) have `code: 'TIMEOUT'`. `err.retryable`
tells the outbox whether to try again; `err.issues` lists field errors from `VALIDATION_ERROR`.

**Idempotency.** Every POST/PATCH/PUT/DELETE gets a random UUID `Idempotency-Key` unless you pass one in the
last argument: `api.orders.create(body, { idempotencyKey })`. The outbox persists the key with the item, so
a retry after a dropped connection is applied once. `api.http.request()` exposes `idempotentReplay`.

**Outbox.** Storage is any `{ get, set, remove }` (adapters: `syncStorageAdapter` for MMKV or
`localStorage`, `asyncStorageAdapter` for AsyncStorage, `memoryStorage` for tests). Items replay in order.
A 4xx (other than 408, 429 and `IDEMPOTENCY_IN_PROGRESS`) marks the head item `failed` and blocks the queue
until `dismiss(id)` or `retry(id)`; 5xx and network errors retry with exponential backoff (1 s doubling to
60 s, with jitter) up to `maxAttempts` (20). `subscribe` gives `{ items, pending, flushing, online, failed }`.

**Realtime.** The token goes in `?token=`. Handlers subscribe per channel; the server subscription is sent
once and re-sent with `lastSeq` after every reconnect so missed events are replayed. When the server cannot
cover the gap it sends `type: 'resync'`, surfaced through `onResync(channel)`: refetch that data over REST.
Reconnect backoff is 1 s doubling to 30 s with jitter; a 4401 close stops reconnecting and calls
`onUnauthorized`. `status` is an observable of `connecting | open | closed`. Persist `lastSeq(channel)` and
restore it with `setLastSeq` to catch up across app restarts.

**Uploads.** `uploadFile` reads a `file://` URI with fetch (or takes a `Blob`), presigns for the bucket, PUTs
with the returned headers and returns `{ key }`. Only the uploader (or staff) may attach the key.

## Tests

```bash
pnpm --filter @farmgo/sdk test:unit           # mocked fetch and WebSocket
pnpm --filter @farmgo/sdk test:integration    # boots the real API on the test database (pnpm infra:up first)
pnpm --filter @farmgo/sdk test                # both; via turbo it runs after @farmgo/api tests
```

The integration test shares `farmgo_test` with `apps/api`, so `packages/sdk/turbo.json` makes the SDK test
task wait for the API test task instead of running alongside it.
