# Endpoint checklist

Generated from the dev API's OpenAPI document (http://localhost:4000/docs/openapi.json) on 2026-09-26:
114 operations, each with an SDK method. Regenerate by running the script noted in
docs/tickets/002-sdk.md after the API adds paths, or diff this table against /docs.

SDK methods for paths that are in the API source but not yet in the running dev API's document:
- `POST /v1/orders/{id}/confirm-receipt` as `api.orders.confirmReceipt`

Better Auth paths (/api/auth/*) are hidden from OpenAPI. The SDK wraps the ones the app and tests use
under `api.auth` (signInEmail, signUpEmail, sendOtp, verifyOtp, session, signOut).

| Done | Operation | Tag | SDK method | Summary |
|---|---|---|---|---|
| x | `GET /health/live` | health | `api.health.live` | Process is up |
| x | `GET /health/ready` | health | `api.health.ready` | Dependencies reachable |
| x | `GET /v1/me` | me | `api.me.get` | Current user, role, permissions and organizations |
| x | `PATCH /v1/me` | me | `api.me.update` |  |
| x | `PATCH /v1/me/farmer-profile` | me | `api.me.updateFarmerProfile` |  |
| x | `POST /v1/onboarding/farmer` | me | `api.onboarding.farmer` | Register as a farmer |
| x | `POST /v1/onboarding/buyer` | me | `api.onboarding.buyer` | Register a hotel, restaurant or other buyer |
| x | `POST /v1/onboarding/supplier` | me | `api.onboarding.supplier` | Register a green-input enterprise |
| x | `GET /v1/orgs/current` | me | `api.orgs.current` | The organization you are acting for |
| x | `PATCH /v1/orgs/current` | me | `api.orgs.updateCurrent` |  |
| x | `POST /v1/agent/farmers` | me | `api.agent.createFarmer` | Register a farmer (field agent) |
| x | `GET /v1/agent/farmers` | me | `api.agent.farmers` | Farmers I onboarded |
| x | `POST /v1/agent/farmers/{id}/farms` | farms | `api.agent.addFarm` | Add a farm for a farmer (field agent) |
| x | `POST /v1/uploads/presign` | uploads | `api.uploads.presign (and uploadFile)` | Get a URL to upload a photo or document directly to storage |
| x | `POST /v1/uploads/url` | uploads | `api.uploads.url` | Get a short-lived URL to view a file |
| x | `GET /v1/farms` | farms | `api.farms.list` | My farms |
| x | `POST /v1/farms` | farms | `api.farms.create` |  |
| x | `GET /v1/farms/{id}` | farms | `api.farms.get` |  |
| x | `PATCH /v1/farms/{id}` | farms | `api.farms.update` |  |
| x | `GET /v1/produce` | catalog | `api.produce.list` | Produce catalog (English and Kiswahili names) |
| x | `POST /v1/produce` | catalog | `api.produce.create` | Add produce (admin) |
| x | `GET /v1/produce/{id}` | catalog | `api.produce.get` |  |
| x | `PATCH /v1/produce/{id}` | catalog | `api.produce.update` | Edit produce (admin) |
| x | `GET /v1/supply` | supply | `api.supply.list` | Browse available and upcoming produce |
| x | `POST /v1/supply` | supply | `api.supply.create` | List produce (available now or upcoming harvest) |
| x | `GET /v1/supply/{id}` | supply | `api.supply.get` |  |
| x | `PATCH /v1/supply/{id}` | supply | `api.supply.update` |  |
| x | `POST /v1/supply/{id}/harvest-ready` | supply | `api.supply.harvestReady` | Report the harvest is in; confirmed orders go to inspection |
| x | `GET /v1/demand` | demand | `api.demand.list` | My organization's requirements |
| x | `POST /v1/demand` | demand | `api.demand.create` | Post a one-off or recurring requirement |
| x | `GET /v1/demand/board` | demand | `api.demand.board` | What buyers need, by produce, county and week (anonymised) |
| x | `GET /v1/demand/{id}` | demand | `api.demand.get` |  |
| x | `PATCH /v1/demand/{id}` | demand | `api.demand.update (and demand.cancel)` |  |
| x | `GET /v1/matches` | matches | `api.matches.list` | Proposed and past matches for me or my organization |
| x | `POST /v1/matches/{id}/accept` | matches | `api.matches.accept` | Accept a proposed match; the order is created once both sides accept |
| x | `POST /v1/matches/{id}/reject` | matches | `api.matches.reject` |  |
| x | `GET /v1/orders` | orders | `api.orders.list` | Orders visible to me |
| x | `POST /v1/orders` | orders | `api.orders.create` | Order directly from a listing |
| x | `GET /v1/orders/{id}` | orders | `api.orders.get` |  |
| x | `POST /v1/orders/{id}/confirm` | orders | `api.orders.confirm` | Farmer confirms a new order |
| x | `POST /v1/orders/{id}/ready` | orders | `api.orders.ready` | Farmer marks the order harvested and ready for inspection |
| x | `POST /v1/orders/{id}/cancel` | orders | `api.orders.cancel` |  |
| x | `POST /v1/orders/{id}/transition` | orders | `api.orders.transition` | Move an order to another status (validated by the state machine) |
| x | `POST /v1/orders/{id}/pay` | payments | `api.orders.pay` | Pay a prepaid order with M-Pesa (STK push to the phone) |
| x | `POST /v1/orders/{id}/dispute` | orders | `api.orders.dispute` | Report a problem with a delivered order |
| x | `POST /v1/orders/{id}/review` | orders | `api.orders.review` | Rate the other side after delivery |
| x | `GET /v1/orders/{id}/messages` | orders | `api.orders.messages` |  |
| x | `POST /v1/orders/{id}/messages` | orders | `api.orders.sendMessage` | Message the other side about this order |
| x | `GET /v1/orders/{id}/tracking` | logistics | `api.orders.tracking` | Live delivery tracking for an order |
| x | `GET /v1/qa/tasks` | qa | `api.qa.tasks` | Orders waiting for inspection |
| x | `POST /v1/qa/inspections` | qa | `api.qa.inspect` | Record an inspection for one order item |
| x | `GET /v1/qa/inspections/{id}` | qa | `api.qa.inspection` |  |
| x | `GET /v1/routes` | logistics | `api.routes.list` | All routes (admin) |
| x | `POST /v1/routes/build` | logistics | `api.routes.build` | Batch QA-passed orders into delivery routes |
| x | `POST /v1/routes/{id}/assign` | logistics | `api.routes.assign` |  |
| x | `GET /v1/routes/today` | logistics | `api.routes.today` | My routes for today and anything still open (driver) |
| x | `GET /v1/routes/{id}` | logistics | `api.routes.get` |  |
| x | `POST /v1/routes/{id}/start` | logistics | `api.routes.start` |  |
| x | `POST /v1/routes/{id}/location` | logistics | `api.routes.location` | Share driver location (REST fallback for the WebSocket) |
| x | `POST /v1/stops/{id}/arrive` | logistics | `api.stops.arrive` |  |
| x | `POST /v1/stops/{id}/complete` | logistics | `api.stops.complete` | Complete a pickup or drop-off (with proof of delivery and crate scans) |
| x | `POST /v1/stops/{id}/fail` | logistics | `api.stops.fail` |  |
| x | `POST /v1/crates` | crates | `api.crates.create` | Register a batch of reusable crates (admin) |
| x | `GET /v1/crates` | crates | `api.crates.list` |  |
| x | `GET /v1/crates/{qrCode}` | crates | `api.crates.get` |  |
| x | `POST /v1/crates/scan` | crates | `api.crates.scan` | Scan a crate QR code to record where it is |
| x | `GET /v1/payments` | payments | `api.payments.list` | My organization's payments |
| x | `GET /v1/payments/{id}` | payments | `api.payments.get` | Poll a payment (e.g. after an STK push) |
| x | `GET /v1/invoices` | payments | `api.invoices.list` |  |
| x | `GET /v1/invoices/{id}` | payments | `api.invoices.get` |  |
| x | `POST /v1/invoices/{id}/pay` | payments | `api.invoices.pay` | Pay an invoice with M-Pesa |
| x | `GET /v1/payouts` | payments | `api.payouts.list` | My payouts (farmer) |
| x | `GET /v1/prices` | pricing | `api.prices.index` | Weekly price index (transacted prices) |
| x | `GET /v1/prices/latest` | pricing | `api.prices.latest` | Latest price for each produce (optionally one county) |
| x | `GET /v1/forecasts` | pricing | `api.forecasts.list` | Forecast demand for the coming weeks |
| x | `GET /v1/inputs` | inputs | `api.inputs.list` | Browse green inputs |
| x | `POST /v1/inputs` | inputs | `api.inputs.create` | List a product (supplier) |
| x | `GET /v1/inputs/{id}` | inputs | `api.inputs.get` |  |
| x | `PATCH /v1/inputs/{id}` | inputs | `api.inputs.update` |  |
| x | `POST /v1/inputs/{id}/order` | inputs | `api.inputs.order` | Order a green input |
| x | `GET /v1/input-orders` | inputs | `api.inputOrders.list` | Input orders I placed, or received as a supplier |
| x | `POST /v1/input-orders/{id}/transition` | inputs | `api.inputOrders.transition` |  |
| x | `GET /v1/notifications` | notifications | `api.notifications.list` | In-app inbox |
| x | `POST /v1/notifications/read` | notifications | `api.notifications.markRead` | Mark some or all as read |
| x | `GET /v1/notifications/preferences` | notifications | `api.notifications.preferences` |  |
| x | `PATCH /v1/notifications/preferences` | notifications | `api.notifications.updatePreferences` |  |
| x | `POST /v1/devices` | notifications | `api.devices.register` | Register this device for push notifications |
| x | `DELETE /v1/devices/{token}` | notifications | `api.devices.unregister` | Unregister on sign-out |
| x | `GET /v1/admin/summary` | admin | `api.admin.summary` | Operations summary |
| x | `GET /v1/admin/reports/impact` | admin | `api.admin.impact` | Impact metrics for EYAAM and funders |
| x | `GET /v1/admin/users` | admin | `api.admin.users.list` |  |
| x | `GET /v1/admin/users/{id}` | admin | `api.admin.users.get` |  |
| x | `POST /v1/admin/users/{id}/role` | admin | `api.admin.users.setRole` | Assign a platform role (e.g. agent, qa_officer, driver) |
| x | `POST /v1/admin/users/{id}/ban` | admin | `api.admin.users.ban` |  |
| x | `POST /v1/admin/farmers/{id}/kyc` | admin | `api.admin.kyc.review` | Approve or reject a farmer ID check |
| x | `GET /v1/admin/kyc` | admin | `api.admin.kyc.pending` | Farmer ID checks waiting for review |
| x | `GET /v1/admin/orgs` | admin | `api.admin.orgs.list` |  |
| x | `POST /v1/admin/orgs/{id}/verify` | admin | `api.admin.orgs.verify` | Verify a buyer and set credit terms |
| x | `POST /v1/admin/matches` | admin | `api.admin.matches.create` | Create or override a match manually |
| x | `GET /v1/admin/disputes` | admin | `api.admin.disputes.list` |  |
| x | `POST /v1/admin/disputes/{id}/review` | admin | `api.admin.disputes.review` | Mark a dispute as under review |
| x | `POST /v1/admin/disputes/{id}/resolve` | admin | `api.admin.disputes.resolve` |  |
| x | `GET /v1/admin/payouts` | admin | `api.admin.payouts.list` |  |
| x | `POST /v1/admin/payouts/{orderId}/retry` | admin | `api.admin.payouts.retry` |  |
| x | `POST /v1/admin/payments/manual` | admin | `api.admin.payments.manual` | Record a bank transfer or cash payment |
| x | `GET /v1/admin/settings` | admin | `api.admin.settings.get` |  |
| x | `PUT /v1/admin/settings/{key}` | admin | `api.admin.settings.set` |  |
| x | `GET /v1/admin/audit` | admin | `api.admin.audit` |  |
| x | `POST /v1/admin/jobs/{name}/run` | admin | `api.admin.jobs.run` | Run a scheduled job now |
| x | `POST /webhooks/mpesa/stk` | webhooks | `api.webhooks.mpesaStk` | Daraja STK push result |
| x | `POST /webhooks/mpesa/b2c/result` | webhooks | `api.webhooks.mpesaB2cResult` | Daraja B2C payout result |
| x | `POST /webhooks/mpesa/b2c/timeout` | webhooks | `api.webhooks.mpesaB2cTimeout` | Daraja B2C queue timeout |
| x | `POST /webhooks/ussd` | webhooks | `api.webhooks.ussd` | Africa's Talking USSD session step |
| x | `POST /webhooks/sms/delivery-report` | webhooks | `api.webhooks.smsDeliveryReport` | Africa's Talking SMS delivery report |
