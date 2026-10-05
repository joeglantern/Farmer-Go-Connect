# 003 SDK on DTOs, then the admin console

- **Owner:** Spare
- **Status:** review
- **Reviewer:** Lead

## Part A: SDK types from contracts (small)
B01 has landed: every response has a Zod DTO in `packages/contracts/src/dto` (`MeDto`, `ListingPageDto`, `OrderDetailDto`, ...). Replace the hand-written interfaces in `packages/sdk/src/types.ts` with `z.infer` of the DTOs so the SDK can never drift from the API. Add the SDK tests to `.github/workflows/ci.yml` (after the API tests, same database). Keep 45 tests green.

## Part B: admin console in the app (main work)
You are cleared to edit `apps/app` for the files below only. Read `docs/APP_CONVENTIONS.md` first, and study the existing screens (`src/app/(auth)/*`, `src/features/home/*`) and `src/ui/*` so your screens look like they came from the same hand.

Build APP_SPEC.md screens 55 to 61 (Admin, web first, must also work on a tablet and on a phone):
- Tabs (replace the InProgress placeholders): `src/app/(app)/(tabs)/people.tsx`, `money.tsx`, `logistics.tsx`, and the admin branch of `home.tsx` (Overview: ops summary cards and the impact report with a date range). For `home.tsx`, add only `if (role === 'admin') return <AdminOverview />;` and put the screen in `src/features/admin/`.
- Stack screens under `src/app/(app)/admin/`: `catalog.tsx` (produce list, add, edit), `settings.tsx` (business settings with validation, scheduled jobs with Run now, audit log), `users/[id].tsx` (detail, set role, ban with reason, KYC review with the ID image), `orgs/[id].tsx` (verify, payment terms, credit limit), `disputes/[id].tsx` (resolve with or without refund), `routes/[id].tsx` (stops, assign driver).
- Orders for admins: the Orders tab is the Lead's, but add an admin order table component `src/features/admin/OrdersTable.tsx` the Lead will mount.
- Expanded width uses real data tables (sortable columns, row hover, sticky header, pagination by cursor); compact width turns rows into cards.
- Every destructive or money action goes through `useDialog().confirm` with specific copy ("Refund KES 6,000 to Serena Demo Hotel?") and shows a toast after.
- All copy in en.ts and sw.ts under an `admin` namespace.

Endpoints: `/v1/admin/*`, `/v1/routes*`, `/v1/crates*`, `/v1/produce` (see OpenAPI at http://localhost:4000/docs). Sign in as `admin@farmgo.test` / `farmgo-demo-2026`.

## Acceptance
Part A merged; every admin screen reachable from the sidebar, works at 390, 820 and 1440 wide, light and dark, English and Kiswahili, with loading, empty and error states; typecheck and biome clean. Status to review and message the Lead.

## Notes (Spare, 2026-09-26)
- Part A: packages/sdk/src/types.ts now aliases z.infer of the contracts DTOs. SDK tests run in CI after the API tests (same database). SDK typecheck, biome and 45 tests green.
- Part B: Overview (home.tsx admin branch), People, Money, Logistics tabs; stack screens admin/catalog, admin/settings, admin/users/[id], admin/orgs/[id], admin/disputes/[id], admin/routes/[id]; OrdersTable and DisputesTable for the Lead to mount. Shared DataTable: sortable columns, sticky header, hover, cursor pagination; cards below 600 wide. Every money or destructive action goes through useDialog().confirm with specific copy and a toast. All copy under admin in en.ts and sw.ts.
- Settings covers the B07 fields: deliveryWindows as removable chips with an add field validated by DELIVERY_WINDOW_PATTERN, nextDayCutoffHour as an hour stepper.
- tsc and biome clean for features/admin and the admin routes.
- Verified live at 1440 in Kiswahili (Overview with real data). The browser extension then disconnected, so 390 and 820 widths, dark mode and the other screens were not checked in the preview.
- Backend gaps: no GET /v1/admin/orgs/:id or /v1/admin/disputes/:id, so detail screens page through the list to find the record. No admin endpoint for payments or invoices lists across orgs, so Money has payouts, disputes and manual payments only.
