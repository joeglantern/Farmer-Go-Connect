# FarmGo Connect

Demand-led marketplace connecting smallholder farmers with hotels, restaurants, households and other buyers in Kenya, with quality checks at the farm gate, crate-based delivery and M-Pesa escrow. Built by EYAAM. See [PLAN.md](PLAN.md) for the product and architecture plan.

One codebase serves every role: buyers (businesses and households), farmers, field agents, QA officers, drivers, green-input suppliers and admins, on Android, iOS and the web.

**App:** Expo SDK 57 (React Native, Expo Router, TanStack Query), English and Kiswahili, phone, tablet, foldable and desktop layouts.
**Backend:** TypeScript · Fastify 5 · Prisma 7 · PostgreSQL 16 + PostGIS (self-hosted) · Better Auth · WebSockets + Redis pub/sub · BullMQ · MinIO · M-Pesa Daraja · Pesapal (cards) · Africa's Talking (SMS/USSD) · Expo push

---

## Quick start

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env              # defaults work for local development
pnpm infra:up                     # Postgres+PostGIS :5440, Redis :6390, MinIO :9010/:9011, Mailpit :8030
pnpm db:migrate                   # apply migrations and generate the Prisma client
pnpm db:seed                      # produce catalog + demo marketplace
pnpm dev                          # API on :4000 and the worker, with reload
pnpm --filter @farmgo/app web     # the app in the browser on :8081 (or `start` for Expo Go)
```

The app finds the API on your computer by itself in development. To try it on a phone with Expo Go, set `EXPO_PUBLIC_API_URL` to your computer's LAN address (see `apps/app/.env.example`). Run `pnpm dev` from a normal terminal and keep it open; it should be the only copy running.

- API docs (OpenAPI, generated from the Zod schemas): http://localhost:4000/docs
- Job dashboard (admins): http://localhost:4000/admin/queues
- Emails sent in development: http://localhost:8030 (Mailpit)
- MinIO console: http://localhost:9011 (farmgo / farmgo-secret)

In development, SMS, push and M-Pesa use local stand-ins: messages and OTP codes are printed in the API/worker logs, and M-Pesa payments succeed a few seconds after the STK push. Phone numbers ending in `000` cancel and `999` fail, to exercise error paths.

### Demo accounts (after `pnpm db:seed`)

| Who | Sign in |
|---|---|
| Admin | `admin@farmgo.test` / `farmgo-demo-2026` |
| Hotel buyer (prepaid) | `buyer@serena.test` / `farmgo-demo-2026` |
| Restaurant buyer (NET 14 invoices) | `chef@javahouse.test` / `farmgo-demo-2026` |
| Household buyer (prepaid, personal account) | `household@farmgo.test` / `farmgo-demo-2026` |
| QA officer / driver / field agent | `qa@` · `driver@` · `agent@farmgo.test` / `farmgo-demo-2026` |
| Green input supplier | `compost@greenyouth.test` / `farmgo-demo-2026` |
| Farmers (phone OTP) | `+254711000001` to `+254711000004`, code printed in the API log |

Create a real admin with `pnpm --filter @farmgo/api create-admin you@example.com "Your Name" 'long-password'`.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API and worker with reload |
| `pnpm test` | Unit and integration tests (needs `pnpm infra:up`) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Types, Biome lint, Biome format |
| `pnpm build` | Bundle API and worker into `apps/*/dist` |
| `pnpm db:migrate` | Create/apply a migration in development and regenerate the client |
| `pnpm db:deploy` | Apply migrations (production) |
| `pnpm db:studio` | Browse the database |
| `pnpm smoke` | End-to-end API smoke test: one order through every role, plus security probes (`API_URL=... pnpm smoke` for a deployed stack) |
| `pnpm copy-lint` | House style check: no em dashes, emoji or curly quotes in app copy, API messages or docs |
| `node scripts/crawl.mjs` | Visits every app route for every role on phone and desktop and reports broken pages |

Integration tests use a separate database (`farmgo_test`) and Redis db 1, which they empty before each run. Your development data is never touched.

---

## Layout

```
apps/
  app/        Expo app for every role (Android, iOS, web)
  api/        Fastify HTTP + WebSocket server (routes, plugins, USSD, webhooks, seed)
  worker/     BullMQ processors, cron schedules, outbox relay
packages/
  sdk/        Typed API client generated from the contracts
  config/     Environment loading and validation (fails fast on bad config)
  contracts/  Zod request schemas, enums, roles, domain events, WebSocket protocol, order state machine
  db/         Prisma schema, migrations, client
  auth/       Better Auth setup and role permissions
  core/       Business logic shared by API and worker: matching, orders, payments, logistics,
              QA, pricing, notifications, providers (SMS, push, email, M-Pesa, storage)
infra/        Docker Compose (dev, prod, observability), Dockerfile, Caddy, deploy and scaling scripts
scripts/      Smoke test, route crawler, copy check, screenshot helper
design/       Brand assets and the scripts that produce the app icons and image slices
docs/         Specs, operations, release and QA documents (index below)
```

The app depends only on `@farmgo/contracts` (types and schemas) and never on server packages.

### Documents

| Document | For |
|---|---|
| [docs/APP_SPEC.md](docs/APP_SPEC.md) | Every screen, per role and size class |
| [docs/APP_CONVENTIONS.md](docs/APP_CONVENTIONS.md) | How app screens are built |
| [docs/RELEASE.md](docs/RELEASE.md) | Building and shipping the apps (EAS, TestFlight, APK, web) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, rolling back, backups, secrets, incidents |
| [docs/SCALING.md](docs/SCALING.md) | Capacity, autoscaling and limits |
| [docs/SECURITY.md](docs/SECURITY.md) | Security controls and webhook verification |
| [docs/qa/TEST_PLAN.md](docs/qa/TEST_PLAN.md) | What testers check, per role |
| [docs/qa/BUGS.md](docs/qa/BUGS.md) | Bug log |
| [docs/BACKEND_GAPS.md](docs/BACKEND_GAPS.md) | History of the backend work the app needed |
| [docs/COORDINATION.md](docs/COORDINATION.md) | How the build sessions share the work |

---

## How it works

**Write, then event, then fan-out.** Every state change is written to Postgres together with a row in the transactional outbox. The worker relays outbox rows, woken instantly by `LISTEN/NOTIFY` with polling as a fallback, to:

- Redis pub/sub, which every API node forwards to the WebSocket clients subscribed to that channel.
- Job queues: matching, notifications (in-app, push, SMS, email) and payouts.

**Order lifecycle** (enforced in one place, `packages/contracts/src/order-state.ts`):

```
PENDING → CONFIRMED → READY_FOR_QA → QA_PASSED → IN_TRANSIT → DELIVERED → PAID
                                   ↘ QA_REJECTED               ↘ DISPUTED → PAID | REFUNDED | DELIVERED
PENDING | CONFIRMED | READY_FOR_QA → CANCELLED
```

**Money is held like escrow.**

- A buyer's payment is held until the delivery is accepted.
- The order settles to `PAID`, and the farmer is paid by M-Pesa B2C, once the buyer confirms receipt or the dispute window closes (48 hours by default).
- QA-rejected quantity and dispute refunds come off the farmer's payout.
- Credit-terms buyers are billed on a weekly invoice.

**Matching** scores each candidate listing on five things:

| Factor | Weight |
|---|---|
| Distance (PostGIS) | 35% |
| Price against the weekly price index | 25% |
| Farmer reliability (QA pass rate, on-time delivery) | 20% |
| Harvest date against the date the buyer needs it | 10% |
| Inclusion (youth, women and first-time farmers) | 10% |

Matches are proposals: an order is created only when both the buyer and the farmer accept.

**Realtime:** `wss://<api>/ws?token=<bearer>` (or the session cookie). Protocol and channel names are in `packages/contracts/src/realtime.ts`. Each channel has a gap-free sequence, so a reconnecting client sends `lastSeq` and replays what it missed.

**Offline-first clients** send an `Idempotency-Key` header on writes; a retried request returns the original response.

### Scheduled jobs (Africa/Nairobi)

| When | Job |
|---|---|
| every 5 min | Reconcile M-Pesa payments whose callback never arrived |
| every 15 min | Expire stale match proposals |
| hourly | Settle delivered orders past the dispute window |
| daily 01:00 · 02:00 | Expire old demand/listings · expand recurring demand |
| daily 03:30 · 04:00 | Refresh farmer reliability · trim old events and GPS pings |
| daily 10:00 · 16:00 · 17:00 | Crate return nudges · build tomorrow's routes · harvest reminders |
| daily 23:30 | Update the price index |
| Mondays | Demand digest to farmers, demand forecast, weekly invoices |

Admins can run any of these now: `POST /v1/admin/jobs/:name/run`.

---

## Deployment

The tester stack runs on one VPS with Docker Compose: Caddy (automatic TLS), several API replicas with an autoscaler, the worker, Postgres + PostGIS, Redis, MinIO, nightly off-site backups and Uptime Kuma. Images are built by CI and pushed to GHCR (`api`, `worker`, and `migrate`, which runs `prisma migrate deploy` before a new version starts).

- First deploy, updates, rollback, backups and secrets: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- Replica counts and autoscaling: [docs/SCALING.md](docs/SCALING.md)
- App builds for testers and stores: [docs/RELEASE.md](docs/RELEASE.md)

Before going live with real money:

- Register with the ODPC (Kenya Data Protection Act 2019).
- Get production Daraja credentials and Safaricom's callback IP list (`MPESA_ALLOWED_IPS`), and Pesapal live keys.
- Get an Africa's Talking sender ID and USSD code.
- Turn off mock payment providers and run a restore test from the off-site backup.
