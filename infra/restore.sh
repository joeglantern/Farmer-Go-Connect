#!/usr/bin/env bash
# Restore FarmGo data from backups. Run on the server from the repository root or infra/.
#
#   infra/restore.sh list                      dumps on this server, newest first
#   infra/restore.sh fetch [YYYYMMDD]          download dumps from off-site into infra/backups/offsite/
#   infra/restore.sh verify [dump|latest]      restore into a scratch database, print row counts, drop it
#   infra/restore.sh db <dump|latest> [--into <name>]
#                                              restore into a NEW database (default farmgo_restore_<date>)
#   infra/restore.sh db <dump|latest> --replace
#                                              replace the live database: stops API, worker and autoscaler,
#                                              keeps the current database as <db>_before_<time>, restores,
#                                              then starts everything again
#   infra/restore.sh files [bucket]            copy MinIO buckets back from off-site (overwrites)
#
# Dumps are pg_dump custom format (*.dump) from the backup service; older plain *.sql.gz dumps work
# too. Set COMPOSE_FILE and ENV_FILE to point at another stack (the local test uses
# infra/docker-compose.yml). Add --yes to skip the confirmation prompts.
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-.env.production}
COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [ "$COMPOSE_FILE" = docker-compose.prod.yml ] && [ -f "$ENV_FILE" ] && grep -qE '^SHARED_HOST=true' "$ENV_FILE"; then
  COMPOSE+=(-f docker-compose.shared-host.yml)
fi
[ -f "$ENV_FILE" ] && COMPOSE+=(--env-file "$ENV_FILE")
envval() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
PGUSER=${PGUSER:-$(envval POSTGRES_USER)}
PGUSER=${PGUSER:-farmgo}
PGDB=${PGDB:-$(envval POSTGRES_DB)}
PGDB=${PGDB:-farmgo}

say() { printf '[restore %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "FAILED: $*"; exit 1; }
YES=0
for a in "$@"; do [ "$a" = --yes ] && YES=1; done
confirm() {
  [ "$YES" = 1 ] && return 0
  read -r -p "$1 Type '$2' to continue: " answer
  [ "$answer" = "$2" ] || die "cancelled"
}
psql_q() { "${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "${2:-postgres}" -v ON_ERROR_STOP=1 -Atc "$1"; }

latest_dump() {
  find backups -type f \( -name '*.dump' -o -name '*.sql.gz' \) -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-
}

resolve_dump() {
  local f=${1:-latest}
  if [ "$f" = latest ]; then f=$(latest_dump); fi
  [ -n "$f" ] && [ -f "$f" ] || die "no dump found (${1:-latest}); try: infra/restore.sh list"
  echo "$f"
}

restore_into() {
  local dump=$1 target=$2
  say "creating database $target"
  psql_q "CREATE DATABASE \"$target\" OWNER \"$PGUSER\""
  say "restoring $(basename "$dump") into $target"
  case "$dump" in
    *.dump)
      "${COMPOSE[@]}" exec -T postgres pg_restore -U "$PGUSER" -d "$target" --no-owner --no-privileges \
        --exit-on-error <"$dump"
      ;;
    *.sql.gz)
      gunzip -c "$dump" | "${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$target" -v ON_ERROR_STOP=1 -q
      ;;
    *) die "unknown dump format: $dump" ;;
  esac
}

counts() {
  psql_q "SELECT 'users ' || count(*) FROM \"user\"
          UNION ALL SELECT 'orders ' || count(*) FROM \"Order\"
          UNION ALL SELECT 'payments ' || count(*) FROM \"Payment\"
          UNION ALL SELECT 'listings ' || count(*) FROM \"SupplyListing\"
          UNION ALL SELECT 'migrations ' || count(*) FROM _prisma_migrations" "$1"
}

offsite() {
  local bucket endpoint
  bucket=$(envval OFFSITE_S3_BUCKET)
  endpoint=$(envval OFFSITE_S3_ENDPOINT)
  [ -n "$bucket" ] && [ -n "$endpoint" ] || die "OFFSITE_S3_ENDPOINT and OFFSITE_S3_BUCKET are not set in $ENV_FILE"
  docker run --rm --network farmgo --env-file "$ENV_FILE" -v "$PWD/backups:/backups" \
    --entrypoint /bin/sh rclone/rclone:1.68 -c "
      export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER=\${OFFSITE_S3_PROVIDER:-Other}
      export RCLONE_CONFIG_OFFSITE_ENDPOINT=\$OFFSITE_S3_ENDPOINT RCLONE_CONFIG_OFFSITE_REGION=\${OFFSITE_S3_REGION:-us-east-1}
      export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=\$OFFSITE_S3_ACCESS_KEY RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=\$OFFSITE_S3_SECRET_KEY
      export RCLONE_CONFIG_LOCAL_TYPE=s3 RCLONE_CONFIG_LOCAL_PROVIDER=Minio RCLONE_CONFIG_LOCAL_ENDPOINT=http://minio:9000
      export RCLONE_CONFIG_LOCAL_ACCESS_KEY_ID=\$S3_ACCESS_KEY RCLONE_CONFIG_LOCAL_SECRET_ACCESS_KEY=\$S3_SECRET_KEY
      $1"
}

cmd=${1:-help}
shift || true
case "$cmd" in
  list)
    find backups -type f \( -name '*.dump' -o -name '*.sql.gz' \) -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null | sort -r
    ;;

  fetch)
    day=${1:-}
    mkdir -p backups/offsite
    say "downloading dumps${day:+ for $day} from off-site"
    offsite "rclone copy offsite:\$OFFSITE_S3_BUCKET/postgres /backups/offsite ${day:+--include '*$day*'} --stats 0"
    say "done; see infra/restore.sh list"
    ;;

  verify)
    dump=$(resolve_dump "${1:-latest}")
    scratch="farmgo_verify_$(date +%Y%m%d%H%M%S)"
    trap 'psql_q "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true' EXIT
    restore_into "$dump" "$scratch"
    say "row counts in the restored copy:"
    counts "$scratch" | sed 's/^/    /'
    say "verified $(basename "$dump"); scratch database dropped"
    ;;

  db)
    dump=$(resolve_dump "${1:-latest}")
    shift || true
    into="" replace=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --into) into="$2"; shift ;;
        --replace) replace=1 ;;
        --yes) ;;
        *) die "unknown option $1" ;;
      esac
      shift
    done
    if [ "$replace" = 0 ]; then
      target=${into:-farmgo_restore_$(date +%Y%m%d%H%M)}
      restore_into "$dump" "$target"
      counts "$target" | sed 's/^/    /'
      say "restored into $target. The live database $PGDB was not touched."
      say "to compare: docker compose exec postgres psql -U $PGUSER -d $target"
      exit 0
    fi
    confirm "This replaces the LIVE database $PGDB with $(basename "$dump"). The API is down while it runs." "$PGDB"
    keep="${PGDB}_before_$(date +%Y%m%d%H%M%S)"
    [ -z "$(psql_q "SELECT 1 FROM pg_database WHERE datname = '$keep'")" ] || die "$keep already exists; wait a second and retry"
    say "stopping API, worker and autoscaler"
    "${COMPOSE[@]}" stop autoscaler api worker 2>/dev/null || true
    # Whatever happens from here, never leave the services stopped.
    restart() { "${COMPOSE[@]}" start api worker autoscaler 2>/dev/null || true; }
    trap 'say "stopped early; starting services again"; restart' EXIT
    psql_q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDB' AND pid <> pg_backend_pid()" >/dev/null
    say "keeping the current database as $keep"
    psql_q "ALTER DATABASE \"$PGDB\" RENAME TO \"$keep\""
    if ! restore_into "$dump" "$PGDB"; then
      say "restore failed; putting the previous database back"
      psql_q "DROP DATABASE IF EXISTS \"$PGDB\""
      psql_q "ALTER DATABASE \"$keep\" RENAME TO \"$PGDB\""
      die "restore failed; the previous database is live again"
    fi
    counts "$PGDB" | sed 's/^/    /'
    trap - EXIT
    say "starting API, worker and autoscaler"
    restart
    say "done. The old database is kept as $keep; drop it once you are sure: DROP DATABASE \"$keep\";"
    ;;

  files)
    bucket=${1:-}
    confirm "This overwrites ${bucket:-every bucket} in MinIO with the off-site copy." "restore"
    if [ -n "$bucket" ]; then
      offsite "rclone sync offsite:\$OFFSITE_S3_BUCKET/files/$bucket local:$bucket --stats 0"
    else
      offsite 'for b in $(rclone lsf offsite:$OFFSITE_S3_BUCKET/files --dirs-only | tr -d /); do rclone mkdir local:$b; rclone sync offsite:$OFFSITE_S3_BUCKET/files/$b local:$b --stats 0; done'
    fi
    say "files restored"
    ;;

  *)
    sed -n '2,19p' "$0"
    ;;
esac
