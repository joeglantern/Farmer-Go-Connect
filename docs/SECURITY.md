# Security

What FarmGo protects, how, and how to check it. Operations are in [OPERATIONS.md](OPERATIONS.md).

## What we protect

- **Money.** M-Pesa and card payments, refunds and farmer payouts. The main risks are fake payment confirmations, payouts to the wrong number, and replayed requests.
- **Personal data.** Phone numbers, farm locations, national ID images and dates of birth. The main risks are one user seeing another's data, and data leaking into logs.
- **Accounts.** Sessions and roles. The main risks are stolen tokens and someone gaining a role they should not have.

## Controls

### Authentication and sessions

- Better Auth handles sign-in by phone OTP or email and password. Sessions live in Postgres with a Redis copy, and last 30 days.
- The app sends `Authorization: Bearer <token>`, and the browser uses an HttpOnly cookie, Secure in production. CORS allows only the configured origins.
- Auth has its own rate limits. OTP send is 3 a minute, OTP verify 10, email sign-in 10, and password reset 3 in 5 minutes. An OTP code expires after 5 minutes and allows 5 attempts.
- The API caches a resolved session in Redis for up to `SESSION_CACHE_SECONDS`, 30 by default. Sign-out, session revocation, bans, role changes and any change the user makes invalidate it on the next request.
- Bans revoke every session immediately.

### Authorization

- Every route checks a permission from `@farmgo/auth`, not just a role name. Organization data is scoped to the caller's membership, with the `X-Org-Id` header checked against it.
- A record the caller may not see answers 404, the same as one that does not exist. This is so IDs cannot be probed, for example when undoing harvest-ready on someone else's listing.
- Admin money lists (payments, invoices, payouts across organizations) need `payment:reconcile`, which only admins hold.
- **Impersonation.** An admin viewing the app as another user can look around, but cannot pay, check out, cancel, issue manual payments, retry payouts or resolve disputes. These return 403 `IMPERSONATION_READ_ONLY`. Impersonation sessions last 30 minutes.

### Money

- Amounts are integer KES cents end to end. Request bodies cap them at 32-bit values.
- A payment callback is never trusted alone. An M-Pesa success is confirmed with Daraja's STK query, and every card notification and return is confirmed with Pesapal's status API, before anything is marked paid. Underpayments are caught to the cent.
- A reconcile job re-checks pending payments, so a lost callback is not lost money.
- Creating orders, checkout and payments accept an `Idempotency-Key`, scoped to the route, so a retried request cannot charge twice.
- Payouts go only to the farmer's verified M-Pesa number. Automatic QA refunds are not deducted twice.
- Money routes refuse with 503 `RATE_LIMIT_UNAVAILABLE` if Redis, and so the rate limiter, is down, rather than run unlimited. Other routes stay up.

### Webhooks

| Endpoint | How it is verified |
|---|---|
| `/webhooks/mpesa/stk`, `/b2c/result`, `/b2c/timeout` | `?token=MPESA_CALLBACK_TOKEN` (16+ characters, compared in constant time), optional Safaricom IP allow-list (`MPESA_ALLOWED_IPS`), and a status query before applying a success |
| `/webhooks/ussd` | `?token=AT_USSD_TOKEN`, optional Africa's Talking IP allow-list (`AT_ALLOWED_IPS`), 120 requests a minute |
| `/webhooks/sms/delivery-report` | `?token=AT_DLR_TOKEN` checked before the body is read, the same IP allow-list, 600 requests a minute |
| `/webhooks/pesapal` (IPN) | treated as a hint only: the payment is looked up with Pesapal's status API before anything changes |

Providers cannot send custom headers, so these tokens travel in the URL. They are removed from every log, as described next.

### Logs

- The API's request log replaces the values of `token`, `access_token`, `code`, `otp`, `secret`, `signature`, `key` and `password` query parameters with `[redacted]`. Log fields named password, code, otp and token are redacted too.
- Caddy's access log does the same for query strings. It also drops the `Authorization`, `Cookie`, `Sec-WebSocket-Protocol`, `Set-Cookie` and `Set-Auth-Token` headers.
- The WebSocket token is sent as a subprotocol (`farmgo.bearer`, then the URL-encoded token), not in the URL. `?token=` still works for app builds from before October 2026 and will be removed after the first store release.
- One-time codes appear in the API log only in development.

### Transport and exposure

- Only Caddy is reachable from the internet, on 80 and 443. `infra/firewall.sh` sets ufw to allow 22, 80 and 443 only. Docker publishes no other ports, and internal tools bind to 127.0.0.1.
- HTTPS is served with Let's Encrypt certificates, which Caddy renews. Plain HTTP redirects to HTTPS.
- `/metrics` and `/admin/queues` return 404 on the public hostname. `/metrics` also needs `METRICS_TOKEN`, which production requires. The job dashboard needs an admin session.
- `/docs`, the API reference, is off in production unless `DOCS_PUBLIC=true`.
- Requests time out after 30 seconds, bodies are limited to 1 MB, and uploads go straight to storage through presigned URLs with size limits.
- Every list is paginated or capped, and queries over 15 seconds are cancelled by Postgres.

### Configuration

The API and worker refuse to start in production when any of these hold:

- `BETTER_AUTH_SECRET` is a development value.
- `MPESA_CALLBACK_TOKEN` or `METRICS_TOKEN` is shorter than 16 characters.
- `AT_USSD_TOKEN` or `AT_DLR_TOKEN` is unset.
- Pesapal is enabled without its key, secret and IPN id.
- A mock payment provider is set without the tester-stack switches.

A tester stack, where no real money moves, may use mock M-Pesa and cards only with both `TESTER_STACK=true` and `ALLOW_MOCK_PROVIDERS=true`. It then logs a warning every 15 minutes and reports `farmgo_tester_stack 1` in metrics. Demo accounts are seeded in production only with `TESTER_STACK=true` and `SEED_DEMO=true`.

### Supply chain

- CI fails on any high or critical advisory in production dependencies (`pnpm audit --prod --audit-level high`). It also fails on fixable high or critical findings in the API and worker images (Trivy).
- Patched versions of three transitive dependencies (mysql2, deepmerge-ts, undici) are pinned with overrides in `pnpm-workspace.yaml`.
- The runtime image runs as the `node` user, under `tini`, with Debian security updates applied at build time.
- The autoscaler reaches Docker only through a socket proxy that allows container calls and nothing else. Container create is still a powerful call, so the proxy is on the internal network only.

Accepted exceptions:

| Advisory | Package | Why it is accepted | Review by |
|---|---|---|---|
| GHSA-86w9-cpqp-85rv | node-forge, via `expo > @expo/cli` | build-time tooling for the app only; never in the API or worker images; no patched release yet | 2026-12-31, or at the next Expo upgrade |
| GHSA-vfj7-8cjw-p6xm | braces, via `expo > @expo/cli > metro file map` | build-time tooling only; no patched release yet | 2026-12-31, or at the next Expo upgrade |

Remove each entry from `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` as soon as a fix ships.

## Checking it

Run these against the deployed stack after every infrastructure change:

```
curl -s -o /dev/null -w '%{http_code}\n' https://<API_DOMAIN>/metrics                # 404
curl -s -o /dev/null -w '%{http_code}\n' https://<API_DOMAIN>/admin/queues           # 404
curl -s -o /dev/null -w '%{http_code}\n' https://<API_DOMAIN>/docs                   # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<API_DOMAIN>/webhooks/mpesa/stk            # 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<API_DOMAIN>/webhooks/sms/delivery-report  # 403
sudo ufw status                                                                      # 22, 80, 443 only
docker ps --format '{{.Names}} {{.Ports}}'                                            # only caddy on 0.0.0.0
docker compose -f infra/docker-compose.prod.yml logs api caddy | grep -Ei 'token=[^\[]|bearer [a-z0-9]'   # no output
```

## Reporting a problem

Send security issues privately to the operations email in `ACME_EMAIL`, not to a public issue tracker. Include what you found and how to reproduce it.
