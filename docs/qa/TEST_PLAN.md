# FarmGo Connect test plan

What a tester does to prove FarmGo works end to end, role by role. The Lead builds the API smoke test (`pnpm smoke`) and the route crawler from this file, and QA runs the manual pass from it on the deployed stack, on a real Android phone (preview APK), an iPhone (TestFlight) and the web build.

Report every problem in `docs/qa/BUGS.md` with the steps, what you expected and what happened. Severity: P0 crash or lost data or money, P1 a flow you cannot finish, P2 wrong behaviour, P3 polish.

## Before you start

- **Where:** the web app at `https://app.<vps-ip>.sslip.io`, or the installed app. Both talk to `https://api.<vps-ip>.sslip.io`.
- **Payments are simulated.** An M-Pesa prompt succeeds a few seconds after you pay. A phone number ending in `000` acts as "cancelled by the customer" and one ending in `999` as "payment failed". Card payments open a simulated hosted page.
- **Codes by SMS are not sent to real phones** in the test environment. Ask the person running the test for the code, or sign in as an admin and use Profile, View as.
- **Accounts** (password `farmgo-demo-2026` for every email account):

| Role | Sign in |
|---|---|
| Admin | `admin@farmgo.test` |
| Hotel buyer, pays up front | `buyer@serena.test` |
| Restaurant buyer, pays by invoice (NET 14) | `chef@javahouse.test` |
| QA officer | `qa@farmgo.test` |
| Driver | `driver@farmgo.test` |
| Field agent | `agent@farmgo.test` |
| Input supplier | `compost@greenyouth.test` |
| Farmers | phone `0711 000 001` to `0711 000 004` (code from the test lead) |
| Household | create your own with a new phone number (flow H1) |

- **Run each role twice:** once in English and once in Kiswahili, and once on a phone and once on a tablet or desktop browser.

## Checks on every screen

Do these on every screen you visit, for every role. They are not repeated in the flows below.

1. Nothing shows a raw code such as `orders.title` or `NOT_FOUND`, and nothing is half English, half Kiswahili.
2. While data loads you see a grey placeholder shaped like the content, not a blank screen or a bare spinner.
3. An empty list explains itself and offers one action (for example "List produce").
4. With the network off (airplane mode, or the browser's offline mode) the screen says you are offline and offers Try again; nothing you typed is lost.
5. Every button and link does something. Back returns where you came from, including the phone's back gesture.
6. Text fits: no cut-off labels, no overlapping, no sideways scrolling. Check at phone width and at desktop width, light and dark mode.
7. Money shows as `KES 1,520`. Dates read naturally.
8. No error popups from the browser or the system. Errors appear as a message on the screen or a short toast at the bottom.

## Buyer: hotel or restaurant

**B1. Sign in and look around** (`buyer@serena.test`)
1. Open the app, choose Login, sign in with email.
   Expected: Home opens with Categories, Featured Farmers and Fresh near you.
2. Tap each category, a farmer card, View All, the bell and Deliver to.
   Expected: each opens its own screen. None shows "This page is not here".

**B2. Buy from two farms and pay by M-Pesa**
1. Add produce from two different farmers to the cart.
   Expected: the cart groups lines by farm and shows the subtotal, delivery fee and total.
2. Change a quantity with the stepper, then remove one line.
   Expected: totals update straight away.
3. Proceed to checkout. Pick a saved address, a delivery date and a time window, choose M-Pesa, enter `0712 345 678`, place the order.
   Expected: a "Check your phone" screen with the amount, then success within a few seconds and one order code per farm.
4. Open Orders.
   Expected: both orders under Active, status "Waiting for farmer".

**B3. Payment that fails, then succeeds**
1. Check out again using M-Pesa number `0712 345 999`.
   Expected: a clear "payment failed" message with Try again. No order is marked paid.
2. Try again with `0712 345 678`.
   Expected: success.

**B4. Follow an order to the end** (needs the farmer, QA and driver flows below on the same order)
1. Open the order while the others move it along.
   Expected: the steps update by themselves (Order placed, At the farm, On the way, Delivered) without pulling to refresh.
2. When it is On the way, open Track order.
   Expected: a map with the driver's position, the driver's name, and Call and Message buttons.
3. When it is Delivered, choose Confirm receipt, then Rate this order (4 stars and a comment).
   Expected: "Thanks. The farmer is being paid." The order moves to Past as Complete. Rating shows once and cannot be repeated.

**B5. Report a problem and get a partial refund**
1. On another delivered order choose Report a problem. Try to send with nothing filled in.
   Expected: you are asked to pick a reason and add a few words.
2. Pick "Less than I ordered", describe it, add a photo, send.
   Expected: "Report sent", the order shows the problem is being looked at, and the farmer is not paid yet.
3. The admin resolves it with a refund (flow A4).
   Expected: the order shows "Part refunded" with the refund amount and the M-Pesa receipt.

**B6. Cancel**
1. Place a new order and cancel it before the farmer confirms, with reason "Plans changed".
   Expected: Cancelled with the reason; if you had paid, a full refund appears on the order.

**B7. Post a weekly requirement and accept a match**
1. Requirements, Post a requirement: produce, quantity, grade, maximum price, a date, repeat weekly.
   Expected: a preview of the next dates; after saving it appears in the list.
2. Pause it, then resume it.
   Expected: the status changes each time and the reason is clear.
3. When a match arrives (the farmer lists the same produce nearby), open Matches and accept it.
   Expected: once the farmer accepts too, an order appears in Orders.

**B8. Messages**
1. From an order, Message farmer, send a text and a photo. Press Enter on the web to send.
   Expected: the message appears straight away; the farmer sees it without refreshing; Messages shows an unread count on their side.

**B9. Invoice buyer** (`chef@javahouse.test`)
1. Place an order.
   Expected: no M-Pesa step; the order says it is on invoice.
2. After delivery and the weekly invoice run (admin flow A6), open Invoices.
   Expected: the invoice lists the orders and the total for what was accepted at quality check. Pay it by M-Pesa; it shows Paid.

**B10. Reorder and favourites**
1. On a completed order choose Order again.
   Expected: available items go back into the cart at today's price, and you are told which items are no longer available.
2. Save a farmer and a product as favourites, sign out and in again.
   Expected: they are still in Favorites.

**B11. Account**
1. Profile: change the language, appearance, notification settings and your name.
   Expected: each change sticks after closing and reopening the app.
2. Tap a notification in Notifications.
   Expected: it opens the matching order, match, invoice or payment screen.
3. Export my data.
   Expected: a file downloads (web) or the share sheet opens (phone).
4. Delete account while an order is still open.
   Expected: refused with a clear reason.

## Household buyer

**H1. Sign up and buy**
1. Get Started, Individual / Household, sign up with a new phone number and the code.
   Expected: setup asks for name, county and home address with a map pin (tap the map or Use my current location).
2. Finish setup and buy one item by M-Pesa (as in B2).
   Expected: same flow as a hotel, with no invoice option.
3. As `buyer@serena.test`, open /setup directly.
   Expected: you go straight to Home; a set-up account cannot start household setup. (The API refusal is checked by the smoke test.)

## Farmer

**F1. Sign in by phone and set up** (a new number, or `0711 000 001`)
1. Login, Phone, enter the number, enter the code.
   Expected: a new number goes to setup, which asks for name, county, M-Pesa number, then the first farm with a map pin. An existing farmer goes straight to Home.
2. In setup, enter a date of birth that makes you 16.
   Expected: "You need to be 18 or older to sign up", shown under the date and cleared as soon as you change it.

**F2. List produce**
1. Sell: pick produce, quantity, grade, price (see the market price hint), dates, a photo, the farm, publish.
   Expected: the listing appears in Listings and on the buyer side.
2. Save one as a draft.
   Expected: buyers cannot see it.
3. Close a listing, then reactivate it.

**F3. Handle an order**
1. When a buyer orders, open it from Orders or the notification.
   Expected: the order shows the buyer's request, the date and a Confirm button.
2. Confirm, then mark the harvest ready.
   Expected: the order moves to "Ready for quality check". Undoing harvest ready works until the QA officer starts.
3. After delivery and confirmation (or 48 hours), open Earnings.
   Expected: the payout shows the produce value, the FarmGo fee and what you receive, with the M-Pesa receipt. The monthly chart includes it.

**F4. Demand board and matches**
1. What buyers need: filter to "Matches my produce".
   Expected: only produce you grow; "List this" opens Sell with that produce chosen.
2. Accept a match.
   Expected: once the buyer accepts too, a confirmed order appears.

**F5. Farms and inputs**
1. Add a second farm with a pin, then delete it.
2. Green inputs: order compost, pay by M-Pesa, and confirm when it arrives.
   Expected: the supplier cannot dispatch until you have paid.

## Field agent

**G1.** (`agent@farmgo.test`)
1. Add farmer: phone, name, county, date of birth (try one under 18 first), M-Pesa number, first farm with a pin.
   Expected: under 18 is refused with a clear message; the valid farmer appears under Farmers.
2. Open that farmer and list produce on their behalf.
   Expected: the listing shows under the farmer's name.
3. Sign in as that farmer with the same phone.
   Expected: the farm and listing are already there.

## QA officer

**Q1.** (`qa@farmgo.test`)
1. Tasks: open an order that is ready for inspection.
   Expected: the farm location, the farmer's contact and each item to check.
2. Inspect: accept 30 of 40, reject 10 with a reason and a photo, submit.
   Expected: the order moves on; the buyer is only charged for what was accepted; History shows the inspection.
3. Inspect another order and fail it completely.
   Expected: the buyer is refunded in full and the order ends as "Not passed".

## Driver

**D1.** (`driver@farmgo.test`)
1. Today: open the route and start it.
   Expected: a map with all stops in order; your location is shared while the route is active.
2. At a pickup stop, scan the crates and complete it.
   Expected: the order shows On the way for the buyer.
3. At the drop-off, add a proof of delivery photo, the recipient's name and a signature, complete.
   Expected: the order is Delivered; the crates show as with the buyer.
4. Fail a stop with a reason.
   Expected: the stop shows Failed and the order leaves the route.
5. Scan tab: scan a crate.
   Expected: the crate's history.

## Input supplier

**S1.** (`compost@greenyouth.test`)
1. Products: add a product with photos, price and stock; pause it; unpause it.
   Expected: paused products are hidden from farmers but stay in your list.
2. When a farmer orders and pays, accept, then dispatch.
   Expected: dispatch is refused until the farmer has paid.
3. After the farmer confirms delivery.
   Expected: the order is complete and the payout (minus the fee) shows.

## Admin

**A1. Overview** (`admin@farmgo.test`): the operations summary and the impact report load with numbers.

**A2. People:** find a user, change a role, ban and unban (the banned user is signed out and cannot sign in), approve a farmer's ID check.

**A3. View as:** Profile, View as another user, open a farmer, then a buyer straight away, then Back to my account.
   Expected: a bar at the top shows who you are viewing as. Money actions are refused while viewing as someone else. The view ends by itself after 30 minutes.

**A4. Disputes:** open the problem from B5, mark it under review, resolve with a refund of part of the amount.
   Expected: the buyer sees the refund; the farmer's payout drops by the same amount.

**A5. Logistics:** build today's routes, assign a driver.
   Expected: the driver sees the route in Today. (Routes built for a later date show under the driver's Routes list, not Today.)

**A6. Money and jobs:** in Settings, run "invoice-generate" (weekly invoices) and "settle-delivered" (settles delivered orders and starts farmer payouts); in Money, retry a failed payout.
   Expected: invoices appear for the restaurant; payouts show their status.

**A7. Catalog:** add a produce item, edit it, and copy its ID.
   Expected: "ID copied".

## What the automation covers

- **API smoke (`pnpm smoke`)** runs against any API URL with simulated payments and covers:
  - B1 reads (categories, Kiswahili search, buyer dashboard, featured farmers);
  - B2 with one farm: quote, checkout, M-Pesa payment;
  - B3: a payment that fails, then a retry that succeeds;
  - B4 to the end: farmer confirm and ready, QA pass, delivery, tracking, messages, confirm receipt, farmer payout, rating;
  - B5 with A4: a reported problem resolved with a partial refund;
  - B6: cancelling a paid order refunds it in full;
  - B10: order again;
  - B11: a notification deep link, the delete-account refusal (on its own temporary order) and a delete that succeeds (on a throwaway account);
  - H1 step 3: a business buyer cannot become a household;
  - Q1: partial acceptance with a refund for the rest;
  - every role's home and the admin overview;
  - security: buyers cannot list payouts, signed-out requests are refused, an M-Pesa callback without its token is refused.
- **Manual for now** (people run these in the live pass): B2 with two farms in one checkout, B9 invoice buyer, F2 including the hidden draft, D1 real routes and stops with proof of delivery, S1 input order payment and dispatch, plus everything in B7, B8, F1, F4, F5, G1, A2, A3, A5, A6 and A7.
- **Route crawler (`node scripts/crawl.mjs`)** opens every screen for every role, by default at phone width in Kiswahili and desktop width in English (`--matrix` runs all four), using real ids for detail screens. It fails a page on a console error, a nested button warning, a raw translation key, the "This page is not here" screen, sideways scrolling or being signed out, and lists any screen no role visits. It covers "Checks on every screen" items 1, 5 and 6 automatically.
- **People** still do everything that needs a real device: the camera, crate and photo scanning, location sharing, the M-Pesa prompt on a real phone, push notifications, the share sheet, keyboard behaviour, and how it all looks and reads.
