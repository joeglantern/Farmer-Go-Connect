# Operations

How to run FarmGo Connect in production on one VPS: first setup, deploys, rollbacks, secrets, backups and what to do when something breaks. Capacity and autoscaling are in [SCALING.md](SCALING.md); security controls are in [SECURITY.md](SECURITY.md).

Everything runs from a copy of the repository at `/opt/farmgo` on the server. All commands below run there unless stated.

## Getting the code onto the server

There are two ways. Use the first until the repository has a remote.

**From a dev machine, without a git remote (`infra/ship.sh`).** Run it from the repository root in Git Bash or any shell with ssh, scp, tar and git:

```
pnpm --filter @farmgo/app build:web                        # when the web app changed
infra/ship.sh deploy@<vps-ip> --key ~/.ssh/farmgo --with-web          # copy only
infra/ship.sh deploy@<vps-ip> --key ~/.ssh/farmgo --with-web --deploy # copy, then deploy
```

It packs every tracked file plus new files git does not ignore, or with `--committed`, the last commit only. It adds a `REVISION` file and copies the archive with scp. On the server it updates `/opt/farmgo` in place with rsync, removing files that were deleted locally. These are never sent and never touched: `infra/.env.production`, `infra/state/`, `infra/backups/` and `infra/observability/metrics_token`. The web build is kept when a ship does not include one. `deploy.sh` tags the images with the revision, so `--rollback` works the same way.

The update happens in place, not by swapping directories, because running containers mount the Caddyfile, the backups folder and the web build from these paths.

**From GitHub, once the repository has a remote.** Clone to `/opt/farmgo` once, then `git pull` before each deploy. CI can also deploy on every push to main: it pushes images to GHCR, then runs `infra/deploy.sh --pull --tag <sha>` over SSH. See the `deploy` job in `.github/workflows/ci.yml`, enabled with the `DEPLOY_ENABLED` repository variable.

## Sharing a server with other sites

When the server already runs other sites behind its own nginx on ports 80 and 443 (as the current Contabo VPS does), FarmGo runs in shared-host mode and leaves everything else alone:

- `SHARED_HOST=true` in `infra/.env.production` makes `deploy.sh` and `restore.sh` add `infra/docker-compose.shared-host.yml`. Caddy then listens on `127.0.0.1:${CADDY_LOCAL_PORT}` (8180) over plain HTTP, and Uptime Kuma moves to `127.0.0.1:${KUMA_LOCAL_PORT}` (3392).
- The host nginx terminates HTTPS and forwards the three FarmGo hostnames to Caddy. Install it once, with sudo: `sudo infra/nginx/install-nginx.sh`. It writes a new file, `/etc/nginx/sites-available/farmgo`, checks the whole nginx config before reloading, and asks certbot for one certificate covering only the FarmGo hostnames. No other site file is edited.
- Do not run `infra/firewall.sh` on a shared server: it would close ports other projects use.
- Every FarmGo container, volume and network belongs to the `farmgo-prod` compose project. The deploy script, the autoscaler and the image cleanup only touch that project.
- The code lives in the deploying user's home folder (`/home/liban/farmgo` today), so no sudo is needed for deploys: `infra/ship.sh liban@<host> --dir /home/liban/farmgo --with-web`, then `infra/deploy.sh --build` on the server.

## What runs where

| Service | What it does | Reachable from |
|---|---|---|
| caddy | HTTPS for `api.`, `app.` and `files.` hostnames, load balancing across API replicas, the static web app | the internet (80, 443) |
| api (2 or more) | REST, auth, WebSockets, webhooks | Caddy, Prometheus |
| worker | jobs, notifications, payouts, the outbox relay | nothing inbound except Prometheus |
| autoscaler | adds or removes API replicas | nothing inbound |
| docker-proxy | the only Docker calls the autoscaler may make | the autoscaler |
| postgres, redis, minio | data | the `farmgo` Docker network only |
| backup, backup-offsite | nightly dumps at 02:00, off-site copy at 03:00 (Nairobi) | nothing inbound |
| uptime-kuma | uptime checks | `127.0.0.1:3002` (SSH tunnel) |
| prometheus, grafana, loki, tempo | metrics, dashboards, logs, traces (optional stack) | `127.0.0.1` (SSH tunnel) |

## First setup

1. Install Docker Engine with the compose plugin, and git.
2. Put the code in `/opt/farmgo`: `infra/ship.sh <user@host> --with-web` from your machine, or `git clone` once there is a remote.
3. Run the firewall script: `sudo infra/firewall.sh`. It allows 22, 80 and 443 and denies everything else.
4. Create the environment file: `cp infra/.env.production.example infra/.env.production`, then fill in every blank. Generate each secret on the server with the command written next to it. Set `chmod 600 infra/.env.production`.
5. Make sure the web build is in `apps/app/dist`. `ship.sh --with-web` sends it, or copy the CI artifact. Caddy serves it at `app.`.
6. Deploy: `infra/deploy.sh --build`. The first run starts the data services, applies migrations, starts the worker and `AUTOSCALE_MIN` API replicas, then Caddy. Certificates take up to a minute.
7. Seed the catalog: `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production run --rm --no-deps api node dist/seed.js`. On a tester stack (`TESTER_STACK=true`), add `-e SEED_DEMO=true` before `api` to create the demo accounts too. The live service never gets them.
8. Optional observability: `infra/observability/setup.sh`, then `docker compose -f infra/docker-compose.observability.yml --env-file infra/.env.production up -d`.
9. Check: `curl https://<API_DOMAIN>/health/ready` returns `"status":"ok"`.

## Deploy

```
infra/ship.sh <user@host> --with-web --deploy   # from your machine: copy the code, then deploy

cd /opt/farmgo && git pull                       # or, with a remote, on the server
infra/deploy.sh --build                          # build here and deploy
infra/deploy.sh --pull --tag <git sha>           # or deploy images CI pushed (set IMAGE_REGISTRY)
```

What the script does, in order:

1. Checks the environment file has its secrets, and that the compose file validates.
2. Takes the deploy lock, so the autoscaler holds.
3. Builds or pulls images, tagged with the git commit.
4. Starts the data services and applies migrations. If migrations fail, it stops there and nothing else has changed.
5. Restarts the worker. Jobs wait safely in Redis during the few seconds it is down.
6. Replaces API replicas one at a time. It starts a new replica and waits until `/health/ready` passes, then gives Caddy 8 seconds to start routing to it. Then it stops one old replica. That replica reports "draining" for 15 seconds, Caddy stops sending it new requests, and it finishes in-flight requests before exiting. This repeats until all replicas are new.
7. Validates and reloads the Caddyfile without dropping connections, and updates the support services.
8. Records the deployed tag in `infra/state/current_tag`. The previous tag goes in `previous_tag`.

If a new replica never becomes ready, the script removes it, prints its last log lines and stops. The old replicas keep serving. Fix the problem and deploy again.

WebSocket clients connected to a replica that is replaced are disconnected. They reconnect and catch up from the last event they saw.

## Rollback

```
infra/deploy.sh --rollback
```

This deploys the tag in `infra/state/previous_tag` with the same rolling method, and skips migrations. Migrations only add things (rule 3 in COORDINATION.md), so the previous version runs against the newer schema. If a migration itself was the problem, restore the database (below) before rolling back.

To go back further, run `infra/deploy.sh --tag <older tag>`. The image must still exist locally or in the registry.

## Secrets rotation

Rotate a secret by changing `infra/.env.production` and redeploying with `infra/deploy.sh --tag $(cat infra/state/current_tag)`. Notes per secret:

| Secret | Effect of rotating | Extra step |
|---|---|---|
| `BETTER_AUTH_SECRET` | every user is signed out | warn users first |
| `POSTGRES_PASSWORD` | none if done in order | `ALTER USER farmgo PASSWORD '...'` in Postgres first, then update the file and redeploy |
| `REDIS_PASSWORD` | sessions in Redis survive | restart redis with the new password, then redeploy |
| `S3_SECRET_KEY` | none | update the MinIO root password (recreate the minio container) and redeploy |
| `MPESA_CALLBACK_TOKEN` | in-flight callbacks with the old token are rejected; reconciliation picks those payments up | none, callback URLs are built from the env |
| `AT_USSD_TOKEN`, `AT_DLR_TOKEN` | Africa's Talking calls fail until updated | change the callback URLs in the Africa's Talking dashboard at the same time |
| `METRICS_TOKEN` | Prometheus scrapes fail until updated | run `infra/observability/setup.sh` and restart prometheus |
| `PESAPAL_CONSUMER_SECRET` | card checkouts fail until updated | rotate in the Pesapal dashboard first |

After any rotation, check `/health/ready`, sign in once, and look for 401 or 403 errors in the API log.

## Backups and restore

- **Nightly dumps.** The `backup` service writes a compressed custom-format dump at 02:00 to `infra/backups/`. It keeps 7 daily, 4 weekly and 6 monthly dumps.
- **Off-site copies.** At 03:00 the `backup-offsite` service copies every dump to `s3://$OFFSITE_S3_BUCKET/postgres/`. It also syncs every MinIO bucket to `files/`, and writes `last-success.txt`. Set a lifecycle rule on the off-site bucket, for example to expire objects after 200 days. Run a copy now with `docker compose ... exec backup-offsite /bin/sh /scripts/offsite.sh once`.
- **Monthly restore drill.** Run `infra/restore.sh verify`. It restores the newest dump into a scratch database, prints row counts and drops the scratch database. Write the result in the ops log.

Restoring for real:

```
infra/restore.sh list                         # what is on this server
infra/restore.sh fetch 20261003               # or bring dumps back from off-site
infra/restore.sh db latest                    # into a NEW database, to inspect or copy rows from
infra/restore.sh db <file> --replace          # replace the live database (asks for confirmation)
infra/restore.sh files                        # copy MinIO buckets back from off-site
```

`--replace` stops the API, worker and autoscaler, and keeps the current database as `farmgo_before_<time>`. It then restores, and starts everything again. If the restore fails, it puts the previous database back. Drop the kept copy only once you are sure.

Redis holds sessions, rate limits and queued jobs. It is not backed up off-site. Losing it signs everyone out, and the worker re-creates scheduled jobs on start.

## Incidents

Start with these four checks:

```
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production ps
curl -s https://<API_DOMAIN>/health/ready
docker compose ... logs --tail 200 api worker caddy
docker stats --no-stream
```

| Symptom | Likely cause | What to do |
|---|---|---|
| `/health/ready` shows `database` not ok | Postgres down or out of connections | `docker compose ... logs postgres`. Check `SELECT count(*) FROM pg_stat_activity`. Lower `AUTOSCALE_MAX` or raise `PG_MAX_CONNECTIONS` |
| `redis` not ok, and payments or sign-in return 503 `RATE_LIMIT_UNAVAILABLE` | Redis down. Money and auth routes refuse to run without rate limits, by design | restart redis. The routes recover on their own |
| Slow responses, p95 high | load, a slow query, or too few replicas | the autoscaler adds replicas. Check Grafana for the slow route. Statements over 15s are cancelled and logged |
| 502 from Caddy | no replica ready | `docker compose ... ps api`. Start replicas with `infra/deploy.sh --tag $(cat infra/state/current_tag)` |
| M-Pesa payments stuck pending | callbacks not reaching us, or a Daraja outage | the reconcile job queries Daraja every few minutes. Check the logs for `STK` and 403 on `/webhooks/mpesa` (token mismatch) |
| SMS not delivered | Africa's Talking balance or sender ID | look for `SMS not delivered` warnings with the failure reason |
| Disk full | logs or dumps | `docker system df`. Logs rotate at 5 x 20 MB per container. Old dumps are pruned by the backup service |
| Certificates fail | DNS for the sslip.io name, or port 80 blocked | `docker compose ... logs caddy`, and check `ufw status` |

During an incident, write down the time, what you saw and what you changed. Afterwards, add a regression test or an alert so the same failure is caught earlier next time.
