# Backend audit (ticket 001), 26 September 2026

QA team. Audited the dev API (`pnpm dev`, :4000) with real HTTP calls, the running worker, Postgres and Redis, against PLAN.md sections 3, 10, 12, 13 and 16 and `docs/BACKEND_GAPS.md`. Bugs are in `BUGS.md`; failing tests for every P0/P1 are in `apps/api/test/regressions.test.ts` (21 tests, 19 `it.fails`, 2 passing guards).

## What was covered

- **Every operation in `/docs/openapi.json`** (115 after B01) as the right role: admin, both buyers (prepaid hotel, NET_14 restaurant), QA officer, driver, agent, supplier, four farmers (admin impersonation and real phone OTP), plus fresh `user` accounts. Wrong-role, unauthenticated, IDOR (another org's order, demand, match, invoice, farm, listing, file key, route, input order), validation and error-shape checks on each.
- **Flows end to end over HTTP with the real worker:** demand → match (engine proposal) → both accept → confirmed order → M-Pesa STK (mock) → harvest ready → QA (full, partial, rejected) → route build → assign → start → pickup with crates → GPS ping → tracking → drop-off with a real uploaded proof of delivery → delivered → confirm receipt / dispute window → settlement → payout; direct order; invoice buyer through `invoice-generate` and invoice payment; dispute with partial and full refund; cancel after payment; QA reject after payment; USSD registration, selling, orders, matches, prices, payouts, language toggle; WebSocket auto-join, channel authorization, replay with `lastSeq`, resync, flood limit, driver location.
- **Security:** IDOR on every id-bearing route, role escalation through `/transition`, Better Auth admin and organization endpoints, OTP send and verify limits, password sign-in limits, global 300/min limit, idempotency replays across users, bodies and routes, M-Pesa webhooks with and without the token, USSD webhook, file-key ownership, KYC document access, banned-user handling.
- **Money:** totals, commission, delivery fee, partial QA acceptance, invoice totals, partial and full refunds, manual payments, underpaid callbacks, reconciliation to the cent per order.
- **Worker:** every `POST /v1/admin/jobs/:name/run` job, the outbox relay, failed-job inspection in Redis, notification fan-out (in-app, SMS, email decisions, Kiswahili and English copy).
- **B01 DTO build:** after the restart, every GET and every write endpoint returned a schema-valid response (0 mismatches found).

## What was not covered

- Real Daraja and Africa's Talking (mock M-Pesa and console SMS only); Safaricom IP allow-list; production Caddy/compose; multi-node WebSocket fan-out (single API node).
- Scheduled cron timings (jobs were triggered manually).
- The first half of the audit ran against a stale API and worker (started with plain `tsx` at 17:16, source changed until 17:42). Every finding was re-verified against current source through `regressions.test.ts` or against the restarted build. Payout anomalies seen on the stale worker (payout before settlement, payout ignoring refunds) do not reproduce on current code and are covered by the passing guard QA-019.
- Load and concurrency beyond the existing oversell test.

## Top five risks

1. **USSD webhook is unauthenticated (QA-001, P0).** Anyone who knows the URL can act as any farmer and can overwrite any account that has a phone number (role and name) by "registering" it. Needs a shared secret or IP allow-list before any public deployment, and registration must refuse existing non-farmer accounts.
2. **Money does not reconcile after partial QA, rejection or cancellation (QA-004, QA-005, QA-006, QA-012, QA-023).** Prepaid buyers are charged for rejected produce, invoice buyers are billed the ordered quantity, a paid order that is cancelled or fails QA leaves the buyer's money stuck with no refund path, and an underpaid callback still marks the order paid. Every one of these will be a support case in week one.
3. **State machine bypass through `/transition` (QA-002, QA-003).** A buyer can push an order into DISPUTED with no dispute for an admin to resolve; a QA officer can pass any order without an inspection. Both leave orders that the app cannot move on from.
4. **Buyers get locked out of their own business (QA-007, QA-009, QA-020).** A retried onboarding, or any call to Better Auth's `organization/create`, leaves the account with two orgs or a profile-less active org and every buyer screen answers 400/403. Separately the Expo web origin (:8081) is not trusted, so the web app cannot sign in at all until `.env` changes.
5. **Farmer sign-in entry point rejects the format farmers type (QA-010)** and the farmer-plus-supplier path is dead (QA-008). The app must normalise phone numbers itself until the backend does, and the supplier role needs `input:sell` for farmers or a combined role.

## Notes for the app

- Always send `X-Org-Id` for buyer and supplier calls; the backend cannot pick an org when a user has more than one.
- `/pay` and `/invoices/:id/pay` are limited to 5 per minute per user; presign to 60 per minute; everything else 300 per minute per user. Show the `RATE_LIMITED` message rather than retrying.
- Error copy is English only; translate by `error.code`.
- Idempotency-Key must be unique per request, never reused across endpoints (QA-013).
- Reviews are one per order per author (409 ALREADY_EXISTS on a second one); disputes only on DELIVERED orders inside the window; `allowedTransitions` on order detail is trustworthy for buttons.
- Email is dead in dev until QA-021 is fixed (Mailpit is IPv4 only), so no verification or invoice emails will appear.
