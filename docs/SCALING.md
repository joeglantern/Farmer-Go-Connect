# Scaling

FarmGo runs on one VPS. It scales by adding API replicas on that server, between a minimum and a maximum, behind Caddy. This page covers how to size the server, the limits that matter, and how the autoscaler decides.

The numbers marked *estimate* are planning figures from the configuration, not measurements. Replace them with the results of the load test (Phase 4 of the release plan) once it has run against the deployed stack.

## How a request is served

Caddy terminates HTTPS and spreads requests across API replicas, sending each new request to the replica with the fewest open connections. It finds replicas through Docker DNS every 5 seconds and checks each one's `/health/ready` every 2 seconds.

Each replica keeps its own Postgres pool (`DB_POOL_MAX` connections) and talks to the one Redis. WebSocket events reach every replica through Redis pub/sub, so a client may connect to any replica.

Background work runs in one worker. BullMQ queues in Redis make it safe to restart at any time.

## The connection budget

Postgres has a hard ceiling (`PG_MAX_CONNECTIONS`). Every process holds up to its pool size:

```
API replicas x DB_POOL_MAX  +  worker DB_POOL_MAX  +  10 (backups, migrations, psql)  <=  PG_MAX_CONNECTIONS
```

With the defaults (pool 10, max_connections 100), that allows up to 8 API replicas. The autoscaler computes this ceiling itself and never goes above it, whatever `AUTOSCALE_MAX` says.

Raising `PG_MAX_CONNECTIONS` costs Postgres memory, roughly 5 to 10 MB per connection under load. Raise it only if replicas are actually starved for connections, which shows as waits for the pool rather than for CPU.

## Sizing the server

Check the server first: `nproc` for cores and `free -g` for memory. Then use the row closest to it. *Estimates*:

| VPS | API replicas (min to max) | API limits each | Postgres | PG_MAX_CONNECTIONS | Notes |
|---|---|---|---|---|---|
| 4 vCPU, 8 GB | 2 to 3 | 1 CPU, 768 MB | shared_buffers 1 GB, effective_cache_size 3 GB | 60 | skip the observability stack, or run Prometheus only |
| 6 vCPU, 16 GB | 2 to 4 | 1 CPU, 768 MB | shared_buffers 2 GB, effective_cache_size 6 GB | 100 | the default settings |
| 8 vCPU, 30 GB | 2 to 6 | 1 CPU, 1 GB | shared_buffers 4 GB, effective_cache_size 12 GB | 120 | room for the full observability stack |

The fixed costs on the box are roughly as follows. Worker 768 MB, Redis up to 512 MB, MinIO 512 MB, Caddy 100 MB, and the observability stack about 1.5 GB if it runs. Leave at least 1 GB for the operating system and file cache on top of `shared_buffers`.

Set these in `infra/.env.production`:

| Variable | What it controls | Default |
|---|---|---|
| `AUTOSCALE_MIN`, `AUTOSCALE_MAX` | replica range | 2, 4 |
| `API_CPU_LIMIT`, `API_MEMORY_LIMIT` | per replica | 1.0, 768m |
| `DB_POOL_MAX` | connections per process | 10 |
| `DB_STATEMENT_TIMEOUT_MS` | longest API query before Postgres cancels it | 15000 (the worker uses 120000) |
| `PG_MAX_CONNECTIONS`, `PG_SHARED_BUFFERS`, `PG_EFFECTIVE_CACHE_SIZE`, `PG_WORK_MEM` | Postgres | 100, 512MB, 1536MB, 8MB |
| `HTTP_REQUEST_TIMEOUT_MS` | longest request, body included | 30000 |
| `SESSION_CACHE_SECONDS` | how long a resolved session is cached in Redis | 30 |

## Capacity, per replica (*estimate*)

Most API requests are one to five indexed queries plus JSON serialization. On one dedicated core, a replica should serve roughly 150 to 300 such requests per second. Listing search with distance sorting and dashboards cost more, at about 30 to 60 per second.

A marketplace of a few thousand active farmers and buyers makes well under 20 requests per second on average. So the minimum of 2 replicas leaves a wide margin, and the autoscaler is there for spikes: market days, a bulk SMS campaign, everyone opening the app at 6 a.m.

WebSockets cost little while idle. Plan for about 2,000 open connections per replica before memory becomes the limit.

## The autoscaler

`infra/autoscaler` runs as a container. Every 20 seconds it reads CPU use for each API container from Docker, as a share of that container's CPU limit. It also reads the API's p95 latency from Prometheus, across all routes except `/ws`, `/health` and `/metrics`.

| Rule | Default |
|---|---|
| Scale up when CPU is over `AUTOSCALE_CPU_UP` or p95 is over `AUTOSCALE_P95_UP_MS`, for 2 checks in a row | 70%, 800 ms |
| Scale down when CPU is under `AUTOSCALE_CPU_DOWN` and p95 is under `AUTOSCALE_P95_DOWN_MS`, for `AUTOSCALE_DOWN_SUSTAIN_S` | 25%, 300 ms, 300 s |
| Wait after any change before scaling up again | `AUTOSCALE_UP_COOLDOWN_S` 180 s |
| Wait after any change before scaling down | `AUTOSCALE_DOWN_COOLDOWN_S` 600 s |
| Step size | one replica at a time |
| Below the minimum (a replica crashed) | adds one at once, without waiting |

Without Prometheus it scales on CPU alone. A new replica is a copy of the newest running one: same image, settings and limits. A removed replica drains first, the same way it does during a deploy, so scaling down drops no requests. It holds while a deploy runs (`infra/state/deploy.lock`).

To watch it, run `docker compose -f infra/docker-compose.prod.yml logs -f autoscaler`. Every change is logged with the reason and the CPU and p95 it saw.

Tuning tips:

- If it flaps up and down, widen the gap between the up and down thresholds or lengthen the down cooldown.
- If spikes hurt before it reacts, lower `AUTOSCALE_P95_UP_MS` or raise `AUTOSCALE_MIN`. A new replica needs about 10 to 20 seconds to start and pass readiness.
- If it sits at the maximum for long periods, the server is too small. Move to the next size, or move Postgres to its own server.

## Limits of one server

- **No redundancy.** If the VPS goes down, everything goes down. Off-site backups bound the data loss to the last nightly dump (see OPERATIONS.md). Uptime Kuma tells you when it happens.
- **CPU is shared.** API replicas, Postgres and the worker compete for the same cores. Past about 70% CPU for the whole host, adding replicas stops helping. The autoscaler's per-container CPU reading will not show this, so watch host CPU in Grafana.
- **Postgres is the ceiling.** It cannot scale out on one box. The first signs are slow queries and `statement timeout` errors in the log.

## The next step up

When one server is no longer enough, move in this order. None of these needs code changes:

1. Postgres to a managed database, or its own VPS, with point-in-time recovery. Point `DATABASE_URL` at it and raise the connection budget.
2. Uploads to managed object storage (S3, R2 or B2). Change the `S3_*` settings.
3. API and worker containers to a managed container platform with its own autoscaling, using the same images CI already pushes. The autoscaler and Caddy are then replaced by the platform's load balancer.
