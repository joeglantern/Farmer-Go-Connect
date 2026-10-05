# FarmGo Connect app specification

The single source of truth for what the Expo app contains. QA hunts against this list. Every screen listed here must exist, every control must do something, and every screen must handle its states: **loading** (skeleton, never a bare spinner on first load), **empty** (illustration, one line of copy, one action), **error** (what went wrong, retry), **offline** (cached data plus a banner; writes queue), and **permission denied** (explain and route).

Visual reference: `design/reference/app-screens-mockup.png`. Product truth: `apps/app/PRODUCT.md`.

## Layout classes

| Class | Width | Navigation | Composition |
|---|---|---|---|
| Compact | < 600 dp | Bottom tab bar (4 or 5 tabs) | One column. Primary action in the thumb zone. |
| Medium | 600 to 1023 dp | Navigation rail on the left | List and detail side by side where the flow has both (orders, messages, listings, matches). |
| Expanded | 1024 dp and up | Sidebar with labels, org switcher, profile at the bottom | Dashboards in columns, data tables for admin and buyer order history, detail panes. |

Layout follows the current window width, so a foldable switches as it opens. Sheets become centered dialogs from Medium upward. Nothing is hidden on small screens; it is restructured.

## Global chrome and patterns

- **Tabs.** Buyers: Home, Orders, Messages, Profile (mockup). Farmers: Home, Orders, Sell (center action: add a listing), Messages, Profile. Drivers: Today, Routes, Scan, Profile. QA: Tasks, History, Profile. Agents: Farmers, Add farmer, Profile. Suppliers: Home, Orders, Products, Profile. Admin (web first): Overview, Orders, People, Money, Logistics, Settings.
- **Header.** Screen title left (large title on top-level screens, compact on detail), back button on detail screens that also honors the system back gesture.
- **Dialogs, sheets, toasts and banners are our own components** (no `Alert.alert`, no browser `confirm`). Dialog: title, one or two sentences, primary and secondary actions, destructive variant. Sheet: drag handle, swipe to dismiss, keyboard aware. Toast: bottom, auto-dismiss 4 s, optional action (Undo, Retry). Banner: inline, persistent (offline, account under review, payment pending).
- **Offline:** banner at the top; writes queue through the SDK outbox with a "Waiting to send" chip on the affected item.
- **Language:** English or Kiswahili, switchable from Welcome, Profile, and the sign-in screens. Farmers default to Kiswahili.
- **Money:** always "KES 1,520" with tabular numerals.
- **Pull to refresh** on every list. **Realtime** updates lists and details without refresh.
- **Haptics** on success, error and destructive confirmations (native only).

## Screens

### Onboarding and auth (everyone)
1. **Splash:** logo on brand green, then routes by session.
2. **Welcome** (mockup 1): hero photo of a farmer holding a harvest basket, logo, "From Farm to Your Table", one-line description, Get Started, Login, language switch.
3. **Choose your role** (mockup 2, "Create Your Account"): Hotel / Restaurant, Farmer, Youth Enterprise, Individual / Household. Each card has an illustration, title, one line. "Already have an account? Login".
4. **Sign up:** buyers and youth enterprises by email and password (name, email, password with strength hint, terms); farmers and households by phone number.
5. **Phone sign-in** (phone number, send code) and **Verify code** (6 boxes, auto-read on Android, resend with countdown, change number).
6. **Email sign-in** and **Forgot password** (request, check email, set new password from the link).
7. **Profile setup** by role: Farmer (name, gender optional, date of birth optional, county, M-Pesa number, first farm with a map pin); Hotel/Restaurant (business name, category, county, town, address with map pin, phone, KRA PIN optional); Household (name, county, address with map pin); Youth Enterprise (business name, county, address).
8. **Enable notifications** prompt (our own screen explaining why, then the OS prompt).

### Buyer (hotel, restaurant, household)
9. **Home** (mockup 3): location selector (saved addresses), notifications bell with count, avatar; banner carousel "Fresh. Local. Sustainable."; category grid of 8; Featured Farmers row; for businesses also "Your requirements this week" and "Matches waiting". Business buyers see the **Hotel dashboard** (mockup 10) as their home: stats (Total Orders, This Month Spend), Favorites, New Order.
10. **Category / listings** (mockup 4): search field, filter chips (All, Leafy Greens, Root Crops, Others per category), sort (Nearest, Price, Soonest), list of product rows with photo, name and unit, county, price, Add to Cart (turns into a stepper once added).
11. **Search:** recent searches, suggestions, results across produce and farmers.
12. **Product detail** (mockup 5): full-bleed photo with back and favorite, name and unit, county, price, description, tags (Fresh, Organic, Local), available window, farmer card (links to profile), quality record, price against market, similar produce, quantity stepper, Add to Cart.
13. **Farmer profile:** photo, farm, badges, rating, stats, active listings.
14. **Cart** (mockup 6): lines grouped by farm, steppers, remove, clear all (with dialog), availability warnings, subtotal, delivery fee, total, Proceed to Checkout.
15. **Checkout** (mockup 7): delivery location (saved addresses, add new with map pin), address, preferred delivery date and window, payment method (M-Pesa, Card, Invoice when on credit terms), M-Pesa number, order summary, Place Order.
16. **Payment in progress:** "Check your phone" with the amount and number, live status, cancel and retry; success and failure outcomes. Card opens the hosted page and returns.
17. **Order placed:** confirmation with order codes per farm and next steps.
18. **Orders list:** Active and Past tabs, status pills, search by code.
19. **Order detail:** status timeline, items, farm, delivery window, payments and receipt, QA result with photos, actions by state (pay, cancel, track, confirm receipt, report a problem, review, reorder, message the farmer).
20. **Track order** (mockup 8): progress steps (Order Placed, Processing (at farm), Out for Delivery, Delivered), live map with the driver's position and route, ETA, driver name and vehicle, Call and Message.
21. **Confirm receipt** and **Report a problem** (reason, description, photos) and **Rate this order**.
22. **Requirements** (demand): list of one-off and recurring requirements, **Post a requirement** (produce, quantity, grade, max price, date, repeat weekly/monthly with a preview of dates, delivery location), **Requirement detail** with its matches.
23. **Match review:** the proposed farm, quantity, price, distance, quality record; Accept or Decline.
24. **Invoices** (credit-terms buyers): list, detail with orders, Pay.
25. **Favorites:** saved farmers, produce and categories.
26. **Market prices:** price index by produce and county with trend.
27. **Team** (business owners): members, invite by email, roles, remove.

### Farmer
28. **Farmer dashboard** (mockup 9): profile card, stats (Total Listings, Orders Received, Total Sales, Rating), action cards (matches waiting, orders to confirm, harvests due), My Products.
29. **What buyers need** (demand board): by produce and week for the farmer's county, with "List this" shortcuts.
30. **Sell / Add listing** (multi-step): pick produce (search, recent), quantity with unit, grade, price per unit with the market price hint, available from and to (now or upcoming harvest), photos, farm, review and publish. Save as draft.
31. **My listings:** Open, Upcoming, Sold out, Closed; edit, close, mark harvest ready.
32. **Matches:** proposals with buyer type, quantity, price, date, distance; Accept or Decline.
33. **Orders:** to confirm, in progress, completed; order detail with Confirm, Harvest ready, Cancel (with reason), message the buyer.
34. **Earnings:** total paid, settling, monthly chart, payouts list with M-Pesa receipts.
35. **My farms:** list, add or edit with a map pin, acreage, organic.
36. **Green inputs:** browse compost, fertilizer, seedlings; product detail; order; my input orders.
37. **Verification:** upload national ID (camera or file), status.

### Youth enterprise (input supplier)
38. **Supplier home:** stats, new orders.
39. **Products:** list, add or edit (photos, category, unit, price, stock, county), activate or pause.
40. **Input orders:** accept, reject, dispatch, delivered.

### Field agent
41. **My farmers:** list with verification state; farmer detail (farms, listings).
42. **Register a farmer:** phone, name, county, gender, date of birth, M-Pesa number, first farm with map pin.
43. **List for a farmer:** the Sell flow on the farmer's behalf.

### QA officer
44. **Inspection tasks:** orders ready for QA near me, farm location and farmer contact.
45. **Inspection:** per item: checklist, grade, accepted and rejected quantity, reason when failing, photos; submit.
46. **History:** past inspections.

### Driver
47. **Today:** route summary, Start route.
48. **Route:** map with all stops in order, stop list, share location while active.
49. **Stop:** arrive, pickup or drop-off details, crate scan (camera QR), proof of delivery photo, recipient name, signature pad, complete or fail with reason.
50. **Crate scan:** standalone scanner with the crate's history.

### Everyone
51. **Messages** (inbox of order conversations) and **Chat** (text and photos, read state).
52. **Notifications** (inbox, mark all read, tap opens the right screen).
53. **Profile:** photo, name, role, organization switcher, addresses, payment numbers, language, notification preferences, security (password, two-factor for admins), help, about EYAAM, terms and privacy, sign out, delete account.
54. **Settings subpages** for each Profile row.

### Admin (web first, works on tablet)
55. **Overview:** operations summary and impact report.
56. **Orders:** table with filters, order detail with force transitions, disputes queue and resolution.
57. **People:** users table, roles, bans, KYC queue with ID images, organizations with verification and credit terms.
58. **Money:** payouts (retry failed), payments, record manual payment, invoices.
59. **Logistics:** routes by date, build routes, assign drivers, crates.
60. **Catalog:** produce and categories.
61. **Settings:** business settings, scheduled jobs (run now), audit log.

## Flows that must work end to end
- Household: sign up by phone, set address, browse, add from two farms, check out, pay by M-Pesa, track, confirm receipt, rate.
- Hotel: sign up by email, business profile, post a weekly requirement, accept a match, pay, track, report a problem.
- Credit-terms restaurant: order, receive, invoice appears, pay invoice.
- Farmer: sign in by phone, add a farm, list an upcoming harvest, accept a match, confirm, mark harvest ready, see payout.
- Agent registers a farmer and lists for them; the farmer later signs in with the same phone.
- QA inspects; driver completes pickup and drop-off with crates and proof of delivery.
- Supplier lists compost; farmer orders it; supplier fulfils.
- Admin resolves a dispute with a refund; retries a failed payout.
