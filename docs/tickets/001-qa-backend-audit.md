# 001 QA: backend audit before the app lands

- **Owner:** QA
- **Status:** review
- **Reviewer:** Lead

## Why
The app is being built now. Every backend bug found today is a dead flow the app avoids tomorrow.

## Scope
Audit the running API (`pnpm dev`, docs at http://localhost:4000/docs, demo accounts in `README.md`) against `PLAN.md` sections 3, 10, 12, 13 and 16, and `docs/BACKEND_GAPS.md`.

1. **Walk every endpoint** in the OpenAPI docs as the right role (buyer, farmer by phone OTP, agent, QA, driver, supplier, admin). For each: does it work, does it reject the wrong role, does it validate input, are error messages clear and human (no stack traces, no Prisma messages leaking)?
2. **Walk every flow end to end** with real HTTP calls, not by reading code: demand to match to order to QA to route to delivery to payment to settlement to payout; direct order; invoice buyer; dispute with refund; USSD registration and selling (`POST /webhooks/ussd`); WebSocket catch-up after reconnect.
3. **Security pass:** IDOR (another org's order, match, invoice, message, file), role escalation, rate limits on OTP, idempotency replays, M-Pesa webhook without token, file keys owned by others.
4. **Money pass:** totals, commission, refunds, partial QA acceptance, invoice totals, rounding. Every number must reconcile to the cent.
5. **Worker pass:** trigger every scheduled job with `POST /v1/admin/jobs/:name/run` and check its effect.

## Deliverables
- `docs/qa/BUGS.md` table (format in `docs/COORDINATION.md`), each bug reproducible from the steps.
- For every P0/P1 bug, a failing integration test in `apps/api/test/regressions.test.ts` marked `it.fails(...)` so the Backend team can flip it when fixed.
- A short `docs/qa/backend-audit.md`: what you covered, what you could not, and the top five risks.

## Acceptance
Every endpoint in the docs visited, every flow in point 2 walked, bugs filed with steps. Do not fix backend code yourself; the Backend team fixes, you verify.

## Notes (QA, 26 Sep 2026)
- Deliverables: `docs/qa/BUGS.md` (30 bugs: 1 P0, 11 P1, 9 P2, 9 P3), `apps/api/test/regressions.test.ts` (21 tests: 19 `it.fails` for open P0/P1/P2 bugs, 2 passing guards), `docs/qa/backend-audit.md` (coverage, gaps, top five risks).
- Every OpenAPI operation was visited as the right role; every flow in scope point 2 was walked over HTTP with the running worker.
- The first half of the audit hit a stale API/worker (started with plain `tsx`, not `tsx watch`); the Backend team restarted with `pnpm dev`, and all findings were re-verified against current source. The B01 DTO build was scanned: no response-schema 500s.
- Not done: real Daraja/Africa's Talking, multi-node WebSocket, cron timings, load.
- `pnpm lint` and `pnpm typecheck` are green with the new test file; `regressions.test.ts` runs green as a suite (expected failures counted as passes).
