# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

One Expo universal app (Android, iOS, web). One brand language on every platform, with native affordances respected per OS: back gestures, safe areas, haptics, keyboard behavior, share sheets, platform date/time pickers. Every screen must work at four sizes: phone, tablet, foldable (folded and unfolded, changing live), and desktop web.

## Stack

Chosen with the product owner:
Expo SDK with Expo Router (TypeScript), talking to the existing Fastify backend in this monorepo (`apps/api`). Shared request schemas and roles come from `@farmgo/contracts` and `@farmgo/auth/permissions`. Better Auth client with the Expo plugin for sessions. TanStack Query for server state. WebSocket client for live updates.

## Users

- **Smallholder farmers and youth farming enterprises** (primary, most numerous). Kenyan, often on low-end Android phones with patchy 2G/3G, many most comfortable in Kiswahili. They list what they have or will harvest, respond to buyer demand, confirm orders, mark harvests ready and get paid by M-Pesa. Some never install the app and use USSD instead (already built in the backend).
- **Hotels, restaurants, guesthouses, caterers and institutions** (buyers). Procurement managers and chefs, often on a desktop or tablet in an office or kitchen. They post recurring requirements, browse supply, order, track deliveries, pay by M-Pesa or invoice, and manage a team.
- **Individual households** (buyers, confirmed by the user's mockup). Buy fresh produce for home, paying by M-Pesa.
- **Green-input youth enterprises** selling compost, organic fertilizer, seedlings and packaging.
- **EYAAM staff roles:** field agents (onboard farmers in the field), QA officers (inspect produce at the farm gate), drivers (routes, pickups, drop-offs, crate scans), admins (operations, disputes, payouts, impact reporting).

## Product Purpose

FarmGo Connect is a youth-led, demand-led agricultural supply network by EYAAM. Buyers say what they need before the harvest; farmers grow and list against real demand; the platform matches them, checks quality, aggregates deliveries and pays farmers by M-Pesa once the buyer has the goods. Success: farmers sell more of what they grow at fair, transparent prices; buyers get reliable fresh supply without chasing intermediaries; less food is wasted; young people earn a living running the network.

## Positioning

Demand comes first. Unlike a produce shop, buyers can post recurring requirements that farmers see ahead of harvest, and the matching engine proposes supply by distance, price, reliability, harvest timing and inclusion of youth and women farmers. Every order passes a farm-gate quality check, travels on an aggregated route in reusable crates, and settles escrow-style: the buyer's money is held until delivery is accepted.

## Operating Context

- Farmers act between field work, outdoors, in sunlight, one-handed, sometimes sharing a phone. Data costs money; connectivity drops. Writes must queue offline and retry safely (the backend supports Idempotency-Key).
- Buyers order in batches, often weekly, around menus; they compare prices and need invoices and receipts for accounting.
- Drivers and QA officers work in vehicles and at farm gates; they scan crate QR codes and take proof-of-delivery and inspection photos.
- Money is always Kenyan shillings (backend stores cents). M-Pesa is the default payment rail; credit-terms buyers (NET 7/14/30) pay weekly invoices.
- Languages: English and Kiswahili, switchable anywhere.

## Capabilities and Constraints

- Backend capabilities are defined in `PLAN.md` section 16 and the live OpenAPI docs at `/docs`. The app must not invent flows the backend cannot perform; gaps are recorded in `docs/BACKEND_GAPS.md` and built by the backend team.
- The mockup (`design/reference/app-screens-mockup.png`) is shop-shaped (browse, cart, checkout). Decision (inferred from "do what is best"): keep the mockup's shop flow AND the demand-led flow. A cart that holds items from several farmers checks out as one order per farmer, placed together.
- Payments: M-Pesa (STK push) for everyone; invoice for approved credit-terms buyers; card via a hosted checkout (provider to be added by the backend team).
- Name: **FarmGo Connect** (confirmed; the mockup's "FarmFresh Connect" is superseded).

## Brand Commitments

- Name: FarmGo Connect, a project of EYAAM (Envisioned Youth and Adolescent Ambassadors on the Move). EYAAM logo at `design/reference/eyaam-logo.jpeg` (raster; a clean vector is still needed).
- The user's mockup is the binding visual reference: fresh-produce green, white cards, photographic produce and farmer imagery, rounded pill buttons, bottom tab bar (Home, Orders, Messages, Profile), leaf mark. Replicate it closely and extend it to tablet and desktop.
- Tagline from the mockup: "Good food. Stronger communities. A greener future." Home banner: "Fresh. Local. Sustainable."
- Explicit bans from the user: no em dashes in copy; no generic AI-looking icons or gradients; no stock system alerts or pop-ups. The app uses its own designed dialogs, sheets, toasts and alerts. Icons and illustrations are custom PNG sets generated in batches (prompts in `design/IMAGE_PROMPTS.md`). Quality bar: something that could be featured on Dribbble.

## Evidence on Hand

- Mockup of 10 phone screens: `design/reference/app-screens-mockup.png` (about 230 px per screen; colors and layout are reliable, exact type sizes are approximations).
- EYAAM proposal text (vision, mission, pillars, green innovation, youth employment): `EYAAM business Proposal.pptx`.
- No real farmer photos, testimonials, partner hotels or metrics yet. The app must not fabricate them; demo content is clearly demo data from the seed.

## Product Principles

1. **Demand before supply.** Every screen that shows produce should also show what buyers need.
2. **One hand, low data, two languages.** Farmer flows are finishable one-handed, offline-tolerant, and equally good in Kiswahili.
3. **Money is sacred.** Amounts, fees, payout timing and payment state are always explicit; nothing about money is ambiguous or hidden.
4. **Trust through proof.** Quality checks, photos, live tracking and receipts are surfaced, not buried.
5. **Built by and for young people.** Youth enterprises and staff roles are first-class, not an afterthought.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast on every surface, including text on photos.
- Minimum touch target 48 dp; primary actions reachable by thumb on phones.
- Dynamic type up to 200% without clipping; screen reader labels on every control, in both languages.
- Never rely on color alone for state (order status, payment status, stock).
- Low-literacy friendly: icons paired with words, numbers large and clear, steppers instead of typing where possible.
