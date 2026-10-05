#!/usr/bin/env bash
# FarmGo production deploy on one Docker host, with no dropped requests.
#
#   infra/deploy.sh --build            build images here from this checkout, then deploy
#   infra/deploy.sh --tag <tag>        deploy images already built or pulled under <tag>
#   infra/deploy.sh --pull --tag <t>   pull <tag> from IMAGE_REGISTRY, then deploy
#   infra/deploy.sh --rollback         deploy the tag that ran before the last deploy (no migrations)
#
# Order: preflight, images, data services, migrations, worker, then the API one replica at a time:
# start one new replica, wait until /health/ready passes, give Caddy time to route to it, then stop
# one old replica (it fails readiness first and finishes in-flight requests). Repeat until every
# replica runs the new image. A replica that never becomes ready stops the deploy with the old
# replicas still serving. The autoscaler holds while the lock file exists.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env.production
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
# Shared-host mode (another web server owns 80 and 443): see docker-compose.shared-host.yml.
if [ -f "$ENV_FILE" ] && grep -qE '^SHARED_HOST=true' "$ENV_FILE"; then
  COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.shared-host.yml --env-file "$ENV_FILE")
fi
PROJECT=farmgo-prod
STATE=state
READY_TIMEOUT=${READY_TIMEOUT:-180}
# Caddy checks health every 2s and refreshes replica addresses every 5s.
ROUTE_SETTLE=${ROUTE_SETTLE:-8}

say() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "FAILED: $*"; exit 1; }

BUILD=0 PULL=0 ROLLBACK=0 TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --pull) PULL=1 ;;
    --rollback) ROLLBACK=1 ;;
    --tag) TAG="$2"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

# ── Preflight ────────────────────────────────────────────────────────────────
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (copy .env.production.example and fill it in)"
if grep -Eq '^(BETTER_AUTH_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|S3_SECRET_KEY|METRICS_TOKEN|MPESA_CALLBACK_TOKEN)=$' "$ENV_FILE"; then
  die "a required secret in $ENV_FILE is empty"
fi
mkdir -p "$STATE" backups
if [ "$ROLLBACK" = 1 ]; then
  [ -f "$STATE/previous_tag" ] || die "no previous deploy recorded in $STATE/previous_tag"
  TAG=$(cat "$STATE/previous_tag")
  say "rolling back to $TAG (migrations are not reversed)"
fi
if [ -z "$TAG" ]; then
  # A checkout has git; a tree shipped by infra/ship.sh carries its revision in REVISION.
  TAG=$(git -C .. rev-parse --short HEAD 2>/dev/null || cat ../REVISION 2>/dev/null || date +%Y%m%d%H%M%S)
  TAG=${TAG//[^A-Za-z0-9_.-]/-}
fi
export IMAGE_TAG="$TAG"
"${COMPOSE[@]}" config -q || die "compose file does not validate"

# Hold the autoscaler for the whole deploy; refresh the lock while we work.
touch "$STATE/deploy.lock"
( while [ -f "$STATE/deploy.lock" ]; do touch "$STATE/deploy.lock" 2>/dev/null || true; sleep 60; done ) &
KEEPALIVE=$!
cleanup() { rm -f "$STATE/deploy.lock"; kill "$KEEPALIVE" 2>/dev/null || true; }
trap cleanup EXIT

# ── Images ───────────────────────────────────────────────────────────────────
if [ "$BUILD" = 1 ]; then
  say "building images $IMAGE_TAG"
  "${COMPOSE[@]}" build api worker migrate autoscaler
elif [ "$PULL" = 1 ]; then
  say "pulling images $IMAGE_TAG"
  "${COMPOSE[@]}" pull api worker migrate autoscaler
fi
# `compose config --images <svc>` lists every image on some compose versions, so name them here.
REGISTRY=$(grep -E '^IMAGE_REGISTRY=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
for svc in api worker; do
  img="${IMAGE_REGISTRY:-${REGISTRY:-farmgo}}/$svc:$IMAGE_TAG"
  docker image inspect "$img" >/dev/null 2>&1 || die "image $img not found (use --build or --pull)"
done

# ── Data services and migrations ─────────────────────────────────────────────
say "starting data services"
"${COMPOSE[@]}" up -d --wait postgres redis minio
if [ "$ROLLBACK" = 0 ]; then
  say "applying migrations"
  "${COMPOSE[@]}" run --rm --no-deps migrate || die "migrations failed; nothing else was changed"
fi

# ── Worker (jobs are durable in Redis, so a short restart loses nothing) ─────
say "updating worker"
"${COMPOSE[@]}" up -d --no-deps worker

# ── API, one replica at a time ───────────────────────────────────────────────
api_ids() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=api" --filter status=running
}

wait_ready() {
  local id=$1 waited=0 status
  while [ "$waited" -lt "$READY_TIMEOUT" ]; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo gone)
    case "$status" in
      healthy) return 0 ;;
      gone) return 1 ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

read -r -a OLD <<<"$(api_ids | tr '\n' ' ')"
MIN=$(grep -E '^AUTOSCALE_MIN=' "$ENV_FILE" | cut -d= -f2)
MIN=${MIN:-2}

if [ "${#OLD[@]}" -eq 0 ]; then
  say "no API running yet: starting $MIN replicas"
  "${COMPOSE[@]}" up -d --no-deps --scale "api=$MIN" api
  for id in $(api_ids); do wait_ready "$id" || die "API replica $id never became ready"; done
else
  say "rolling ${#OLD[@]} API replicas to $IMAGE_TAG"
  for old in "${OLD[@]}"; do
    before=$(api_ids | sort)
    count=$(echo "$before" | grep -c . || true)
    "${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "api=$((count + 1))" api
    new=$(comm -13 <(echo "$before") <(api_ids | sort) | head -1)
    [ -n "$new" ] || die "no new API replica appeared"
    say "new replica ${new:0:12} starting"
    if ! wait_ready "$new"; then
      docker logs --tail 50 "$new" || true
      docker rm -f "$new" >/dev/null || true
      die "new API replica never became ready; old replicas are still serving"
    fi
    sleep "$ROUTE_SETTLE"
    say "draining old replica ${old:0:12}"
    docker stop -t 50 "$old" >/dev/null
    docker rm "$old" >/dev/null
  done
fi

# ── Edge and support services ────────────────────────────────────────────────
say "updating Caddy and support services"
if docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=caddy" | grep -q .; then
  "${COMPOSE[@]}" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
    || die "Caddyfile does not validate; the running Caddy was left alone"
  "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
else
  "${COMPOSE[@]}" up -d --no-deps caddy
fi
SUPPORT=(docker-proxy autoscaler backup backup-offsite uptime-kuma)
# Shared-host mode also carries the bridge to the host's SMTP relay.
if grep -qE '^SHARED_HOST=true' "$ENV_FILE"; then SUPPORT+=(smtp-relay-host smtp-bridge); fi
"${COMPOSE[@]}" up -d --no-deps "${SUPPORT[@]}"

# ── Record and verify ────────────────────────────────────────────────────────
[ -f "$STATE/current_tag" ] && [ "$(cat "$STATE/current_tag")" != "$IMAGE_TAG" ] && cp "$STATE/current_tag" "$STATE/previous_tag"
echo "$IMAGE_TAG" >"$STATE/current_tag"

API_DOMAIN=$(grep -E '^API_DOMAIN=' "$ENV_FILE" | cut -d= -f2)
if [ -n "$API_DOMAIN" ] && command -v curl >/dev/null; then
  if curl -fsS --max-time 10 "https://$API_DOMAIN/health/ready" >/dev/null; then
    say "https://$API_DOMAIN/health/ready is OK"
  else
    say "warning: https://$API_DOMAIN/health/ready did not answer OK yet (certificates can take a minute on first deploy)"
  fi
fi
# Only FarmGo images: the server may host other projects.
docker image prune -f --filter "label=com.docker.compose.project=$PROJECT" >/dev/null 2>&1 || true
say "deployed $IMAGE_TAG with $(api_ids | grep -c .) API replicas"
