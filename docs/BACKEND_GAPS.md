# Backend gaps for the app

Owner: **Backend team**. Reviewer: **Lead**. Work top to bottom; the order is the app's build order.
Update the Status column as you go (`todo`, `doing`, `review`, `done`). When an item reaches `review`, message the Lead.

Every item: contracts first (`packages/contracts`), then migration, core logic, route, integration test in `apps/api/test`, and the OpenAPI summary. Keep `pnpm lint && pnpm typecheck && pnpm test` green.

| ID | Item | Status | Summary |
|---|---|---|---|
| B01 | Response DTO schemas for the app's endpoints | done | Zod response DTOs in packages/contracts/src/dto for every app route; a response that does not match fails with 500 in tests, and OpenAPI shows them all. |
| B02 | Image URLs everywhere | done | The serializer adds ready-to-load URLs (imageUrl, photoUrl, photoUrls, podPhotoUrl, signatureUrl); public buckets get stable URLs, private files redirect through GET /v1/files/*. |
| B03 | App categories + new produce categories | done | MEAT and VALUE_ADDED categories with seeded produce; GET /v1/categories returns the 8 home tiles in order with live counts. |
| B04 | Household buyers | done | POST /v1/onboarding/household creates a prepaid HOUSEHOLD buyer org; admins cannot put households on credit terms. |
| B05 | Supply search, sort, distance | done | GET /v1/supply gains q (trigram), category, organic, five sorts and distanceKm, with nearest computed by PostGIS from the query point, default address or org. |
| B06 | Public farmer profiles + featured farmers | done | GET /v1/farmers/featured and GET /v1/farmers/:id with badges, rating and QA pass rate; no phone, coordinates or date of birth. |
| B07 | Server cart, multi-item orders, one-payment checkout | done | Server cart, quote and checkout: one order per farmer with many items, one payment for the checkout, and the delivery fee split by largest remainder. |
| B08 | Saved addresses | done | CRUD at /v1/addresses with one default per owner, used by checkout and by nearest sorting. |
| B09 | Delivery windows | done | deliveryWindows and nextDayCutoffHour settings, GET /v1/delivery/slots, and Order.deliveryWindow used to order route drop-offs. |
| B10 | Dashboards per role | done | One-call dashboards for farmer, buyer, supplier, agent, driver and QA under /v1/dashboard. |
| B11 | Conversations inbox + read receipts | done | GET /v1/conversations with unread counts, POST /v1/orders/:id/messages/read, and unread updates on the user channel. |
| B12 | Favorites | done | Favorites for listings, farmers, produce and categories at /v1/favorites, shown with images on the buyer dashboard. |
| B13 | Card payments (hosted checkout) | done | Pluggable card provider (Pesapal v3, a mock, or disabled); every IPN and return is confirmed through the status API before money moves. |
| B14 | Notification deep links | done | Every notification carries data.route and data.params, and a test fails if any template misses its deep link. |
| B15 | Listing detail enrichment | done | GET /v1/supply/:id adds similar listings, price index, farmer QA stats, distance and tags. |
| B16 | Earnings summary | done | GET /v1/earnings returns monthly gross, commission, net and order counts, plus the amount still settling. |
| B17 | Reorder | done | POST /v1/orders/:id/reorder refills the cart at today's prices and lists what could not be added. |
| B18 | Account deletion + data export | done | POST /v1/me/delete-request anonymizes the account once no orders or payouts are open, and GET /v1/me/export returns the data as JSON. |
| B19 | Staff history endpoints (QA inspections, driver routes) | done | GET /v1/qa/inspections and GET /v1/driver/routes give each officer and driver their own history. |
| B20 | Single-record reads (stop, agent farmer) | done | GET /v1/stops/:id and GET /v1/agent/farmers/:id return single records. |
| B21 | Supplier catalog and order scoping | done | Adds GET /v1/inputs?mine=true and GET /v1/input-orders?as=seller|buyer, and the supplier dashboard shows low stock. |
| B22 | Driver stop enrichment | done | Driver stops show the produce name in Kiswahili and the buyer phone, visible only to the driver on that route. |
| B23 | QA tasks across counties | done | GET /v1/qa/tasks?county=all shows tasks in every county; without it, the list defaults to the officer's county. |
| B24 | Farmer matches and agent farm access | done | GET /v1/demand/board?mine=true shows the demand each listing could fill, and GET /v1/farms?farmerId= serves agents. |
| B25 | Farm and listing lifecycle edits | done | Farm delete and clearing coordinates, reactivating expired listings, and undoing harvest-ready. |
| B26 | Supplier earnings in payouts | done | GET /v1/payouts?as=supplier returns totals for paid this month, pending and held. |
| B27 | Price lookup by produce | done | GET /v1/prices/latest?produceId=&county= returns one price row. |
| B28 | Admin detail and money lists | done | Adds GET /v1/admin/orgs/:id and /v1/admin/disputes/:id, and payments and invoices lists across organizations with filters and totals, limited to admins. |
| B29 | Pause and resume demand | done | PATCH /v1/demand/:id pauses and resumes demand; a paused requirement and its upcoming dates leave matching and the board. |

---

### B01 Response DTO schemas
The app's SDK is typed from `@farmgo/contracts`. Today only request bodies are Zod schemas; responses are untyped Prisma shapes.
- Add response schemas (`XxxDto`) in `packages/contracts/src/dto/*.ts` for every endpoint the app calls (me, farms, produce, supply, demand, matches, orders incl. detail, qa, routes/stops, crates, payments, invoices, payouts, prices, forecasts, inputs, input orders, notifications, uploads, admin lists).
- Wire them as `response: { 200: Dto }` in routes. Decimal must serialize as number, dates as ISO strings (the serializer already converts Decimal and BigInt).
- Paginated lists keep `{ items, nextCursor }`.
- **Done when:** every app-facing route has a response schema, OpenAPI shows them, all tests pass, and a response that does not match its schema fails a test.

### B02 Image URLs everywhere
Clients must never assemble storage URLs.
- Public-read policy on the `produce-photos` and `avatars` buckets (MinIO bucket policy set by `ensureBuckets`), with a stable public URL from `S3_PUBLIC_ENDPOINT`.
- `GET /v1/files/:key(*)` returns a 302 to a presigned URL for private buckets after the existing `canRead` check (so `<Image source={{ uri }} />` works with the auth header).
- Add `imageUrl` to Produce, `photoUrls` to SupplyListing, `imageUrl` to User/avatar and a new `photoKey`/`photoUrl` on Farm, `photoUrls` on InputProduct, QA inspections, POD, chat messages.
- Seed: each catalog produce gets an `imageKey`; the Lead will supply the images in `design/assets/produce/` (until then, leave null and return `imageUrl: null`).
- **Done when:** every image field in every DTO has a ready-to-load URL or null.

### B03 App categories
The home grid shows 8 tiles: Vegetables, Fruits, Meat & Poultry, Dairy, Grains & Staples, Value Added, Natural Fertilizers, All Products.
- Add `MEAT` and `VALUE_ADDED` to `ProduceCategory` (migration). Seed produce for them (beef, goat meat, chicken (whole), honey, peanut butter, dried mango, yoghurt, ghee, sukuma flour mix; realistic Kiswahili names).
- `GET /v1/categories` returns `{ slug, name, nameSw, count, source: 'produce' | 'inputs', produceCategories: [...] }` for the 8 tiles. "Grains & Staples" covers GRAIN, LEGUME, TUBER. "Meat & Poultry" covers MEAT and POULTRY. "Natural Fertilizers" is the green inputs marketplace (COMPOST, ORGANIC_FERTILIZER, BIOPESTICIDE, SEEDLINGS). Counts are of open listings / active input products.
- **Done when:** the endpoint returns all 8 in display order with correct counts.

### B04 Household buyers
The mockup's sign-up offers "Individual / Household".
- Add `HOUSEHOLD` to `BuyerCategory` (migration).
- `POST /v1/onboarding/household { name, county, town?, address?, lat?, lng?, phone? }` makes the user a `buyer` with a personal BUYER organization (name = the person's name, category HOUSEHOLD, PREPAID). No KRA PIN, no team invites for households.
- Households cannot be switched to credit terms by admins (validation in `/v1/admin/orgs/:id/verify`).
- **Done when:** tested end to end, including ordering and M-Pesa payment as a household.

### B05 Supply search, sort, distance
`GET /v1/supply` gains: `q` (trigram search on produce names and farm name), `category` (app category slug from B03), `organic` (boolean), `sort` = `nearest` | `price_asc` | `price_desc` | `newest` | `soonest`, and returns `distanceKm` per listing, measured from (in order) the query's `lat/lng`, the caller's default address (B08), or the caller's organization location.
- Keep the existing redaction (first name only, no phone numbers).
- **Done when:** each sort and filter has a test, and `nearest` uses PostGIS.

### B06 Public farmer profiles + featured farmers
- `GET /v1/farmers/featured?county=&limit=` returns farmers with open listings, ranked by rating, QA pass rate and recent activity, with farm name, county, first name, avatar/farm photo URL.
- `GET /v1/farmers/:id` (public to signed-in users): first name, farm(s) (name, county, ward, organic, photo), rating, orders completed, QA pass rate, member since, badges (`youth`, `woman_led`, `organic`, `verified` from KYC), active listings.
- No phone number, no exact coordinates, no date of birth.
- **Done when:** tested, including that private fields never appear.

### B07 Server cart, multi-item orders, one-payment checkout (largest item)
The mockup is shop-shaped: add produce from several farmers to one cart, check out once, pay once.
- **Cart:** `GET /v1/cart`, `PUT /v1/cart/items { listingId, quantity }` (0 removes), `DELETE /v1/cart`. Stored per buyer organization so it follows the user across phone and desktop. Returns lines with current price, availability (`ok`, `reduced`, `unavailable`), and subtotal. Never reserves stock.
- **Quote:** `POST /v1/checkout/quote { addressId | address, deliveryDate, deliveryWindow }` returns totals per farmer and overall: produce subtotal, one delivery fee per checkout (setting), commission is not shown to buyers, total, and any line problems.
- **Checkout:** `POST /v1/checkout { addressId | address, deliveryDate, deliveryWindow, paymentMethod: 'MPESA' | 'CARD' | 'INVOICE', phoneNumber?, notes? }`. In one transaction: re-price, reserve stock atomically for every line (all or nothing), create one order per farmer with **multiple items** (extend `createOrder`), create a `Checkout` record linking them, clear the cart. Then start one payment for the whole checkout (M-Pesa STK for the total; CARD per B13; INVOICE only for credit-terms buyers).
- A `Payment` may cover a checkout (many orders). On success every order in the checkout becomes PAID-side (`paymentStatus: PAID`); refunds stay per order.
- The delivery fee is split across the checkout's orders for accounting (largest remainder method) so each order's totals stay consistent.
- Idempotent with the `Idempotency-Key` header.
- **Done when:** tests cover a 3-farmer checkout paid by M-Pesa, a stock race, a stale price, an invoice-terms checkout, and cancelling one order of a checkout.

### B08 Saved addresses
- `Address { id, orgId?, userId, label, county, town?, line1, landmark?, lat?, lng?, instructions?, isDefault }`. CRUD at `/v1/addresses`. One default per owner.
- Buyer org location stays the fallback.
- **Done when:** CRUD tested, and checkout and supply `nearest` use the default address.

### B09 Delivery windows
- Setting `deliveryWindows` (default `06:00-08:00`, `08:00-10:00`, `10:00-12:00`, `14:00-16:00`) and `nextDayCutoffHour` (16, Nairobi time).
- `GET /v1/delivery/slots?from=&days=7&county=` returns dates and windows with `available` and a reason when not.
- `Order.deliveryWindow String?` (migration); route building orders drop-offs by window.
- **Done when:** slots respect the cutoff and are shown in order detail and tracking.

### B10 Dashboards per role
One call per home screen:
- `GET /v1/dashboard/farmer`: active listings, orders received (all time and this month), total sales (sum of successful payouts) and this month, rating, and action counts (matches waiting, orders to confirm, harvests due in 48 h, payouts pending).
- `GET /v1/dashboard/buyer`: total orders, this month spend, active orders (with status), upcoming requirements (next 3), matches waiting, invoices due, favorites preview.
- `GET /v1/dashboard/supplier`, `/agent` (farmers onboarded this month, listings created), `/driver` (today's route summary), `/qa` (tasks by county).
- **Done when:** each returns in one round trip, numbers tested against seeded data.

### B11 Conversations inbox
The Messages tab lists conversations. A conversation is an order thread.
- `GET /v1/conversations` returns threads the caller can see, most recent first: order id and code, other party (name, avatar URL, role), last message preview and time, unread count.
- `POST /v1/orders/:id/messages/read` marks read (new `MessageRead` table or `lastReadAt` per participant).
- Realtime: `order.message` already fans out; include `unreadCount` updates on the `user:` channel.
- **Done when:** unread counts are correct for buyer org members and the farmer.

### B12 Favorites
- `Favorite { userId, kind: 'LISTING' | 'FARMER' | 'PRODUCE' | 'CATEGORY', targetId }`, unique per user+kind+target. `GET/POST/DELETE /v1/favorites`.
- Buyer dashboard "Favorites" shows favorite categories and farmers with an image each.
- **Done when:** CRUD tested and favorites appear in the buyer dashboard.

### B13 Card payments
- Add a pluggable card provider (Pesapal API 3.0 is the recommendation for Kenya: cards and mobile money through a hosted page), with a mock provider for development like M-Pesa's.
- `paymentMethod: 'CARD'` on checkout and on order/invoice pay returns `{ redirectUrl }`; IPN webhook `/webhooks/pesapal` verifies with the provider's status API before applying (same rule as M-Pesa: never trust the callback alone). Reconcile cron covers it.
- **Done when:** mock card checkout completes end to end in tests; env vars documented in `.env.example`.

### B14 Notification deep links
Every notification's `data` carries `{ route, params }` the app can open directly, e.g. `{ route: 'order', params: { id } }`, `{ route: 'match', params: { id } }`, `{ route: 'payout', params: { orderId } }`, `{ route: 'route', params: { id } }`, `{ route: 'demand', params: { id } }`, `{ route: 'inputOrder', params: { id } }`.
- **Done when:** every template in `event-notifications.ts` sets it, with a test that none is missing.

### B15 Listing detail enrichment
`GET /v1/supply/:id` adds: `similar` (up to 6 open listings of the same produce nearby), `priceIndex` (latest avg for the buyer's county and the listing's price difference in percent), farmer QA pass rate and completed orders, and `tags` (`fresh` when harvested within 3 days or upcoming within 7, `organic`, `local` when within 30 km).

### B16 Earnings summary
`GET /v1/earnings?months=6` for farmers and suppliers: per month gross, commission, net, number of orders; plus pending (settling) amount.

### B17 Reorder
`POST /v1/orders/:id/reorder` puts the order's items back in the cart at today's prices where the listing is still open, and returns what could not be added.

### B18 Account deletion and data export
Required by the app stores and the Kenya Data Protection Act.
- `POST /v1/me/delete-request`: refused with a clear reason while the user has open orders or unpaid payouts; otherwise anonymizes personal fields, revokes sessions, keeps financial records (orders, payments) with the user detached.
- `GET /v1/me/export`: JSON of the user's profile, farms, listings, orders, payments and messages.

### B19 Staff history endpoints
- `GET /v1/qa/inspections?cursor&limit&passed` for the signed-in officer: inspection, order code, produce, farm, buyer, photos. The app currently filters `/v1/orders` to QA_PASSED/QA_REJECTED.
- `GET /v1/driver/routes?cursor&limit&status` for the signed-in driver (today `/v1/routes` is admin-only). Include stop counts and completedAt.

### B20 Single-record reads
- `GET /v1/stops/:id` (driver on that route, admin): the stop with its route id and order summary, so the stop screen does not need `routeId`.
- `GET /v1/agent/farmers/:id` (the onboarding agent, admin): profile, KYC, farms with listings, performance counts. The app currently pages the whole list.

### B21 Supplier catalog and order scoping
- `GET /v1/inputs?mine=true` returns the caller's products including inactive ones.
- `GET /v1/input-orders?as=seller|buyer` separates orders for my products from orders I placed.
- `GET /v1/dashboard/supplier`: sales this month, orders needing action, low stock (quantity under a threshold setting).

### B22 Driver stop enrichment
Route stop payloads gain produce `nameSw` and the buyer contact phone for drop-offs (driver on that route only).

### B23 QA tasks across counties
`GET /v1/qa/tasks?county=all` (or omit to default to the officer's county) so officers covering several counties can see everything.

### B24 Farmer matches and agent farm access
- Tell a farmer which of their listings fit open demand: `GET /v1/demand/board?mine=true` (or per-listing `matchingDemand`) returning the demand rows each active listing could fill.
- `GET /v1/farms?farmerId=` for the onboarding agent (and admin), so Sell in agent mode can list a farmer's farms.

### B25 Farm and listing lifecycle edits
- `DELETE /v1/farms/:id` (no open listings or orders) and `FarmUpdateInput` accepting `lat: null, lng: null`.
- Listing PATCH can reactivate an EXPIRED listing with new dates; `POST /v1/supply/:id/harvest-ready` gains an undo (`DELETE`).

### B26 Supplier earnings in payouts
`GET /v1/payouts?as=supplier` with totals (paid this month, pending, held), so input suppliers see real earnings instead of client-side sums (overlaps B21).

### B27 Price lookup by produce
`GET /v1/prices/latest?produceId=&county=` so the Sell price hint fetches one row, not the whole list.

### B28 Admin detail and money lists
- `GET /v1/admin/orgs/:id` and `GET /v1/admin/disputes/:id` (the admin detail screens currently page the lists).
- `GET /v1/admin/payments` and `GET /v1/admin/invoices` across organizations, with filters (status, org, date range) and totals.

### B29 Pause and resume demand
`PATCH /v1/demand/:id { status: 'PAUSED' | 'OPEN' }`: paused demand drops out of matching and the demand board, and a recurring requirement pauses its upcoming dates; resuming reopens them and re-runs matching.
