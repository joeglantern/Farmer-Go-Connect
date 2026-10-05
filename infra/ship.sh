#!/usr/bin/env bash
# Ship this checkout to the server without a git remote, then optionally deploy.
#
#   infra/ship.sh <user@host> [--dir /opt/farmgo] [--key ~/.ssh/id_ed25519] [--port 22]
#                             [--committed] [--with-web] [--deploy]
#
#   --committed   ship the last commit only (git archive HEAD). Default: the working tree,
#                 meaning every tracked file plus new files git does not ignore.
#   --with-web    include apps/app/dist (build it first: pnpm --filter @farmgo/app build:web)
#   --deploy      run infra/deploy.sh --build on the server afterwards
#
# Server-only files are never in the archive and are left alone: infra/.env.production,
# infra/state/, infra/backups/ and infra/observability/metrics_token (all git-ignored).
# Files deleted locally are removed on the server too, except those.
# Runs from Git Bash on Windows, or any shell with ssh, scp, tar and git.
set -euo pipefail

cd "$(dirname "$0")/.."
say() { printf '[ship %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "FAILED: $*"; exit 1; }

HOST="" DIR=/opt/farmgo KEY="" PORT=22 COMMITTED=0 WEB=0 DEPLOY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift ;;
    --key) KEY="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --committed) COMMITTED=1 ;;
    --with-web) WEB=1 ;;
    --deploy) DEPLOY=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) HOST="$1" ;;
  esac
  shift
done
[ -n "$HOST" ] || die "usage: infra/ship.sh <user@host> [options]  (see --help)"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run from inside the git checkout"

SSH_OPTS=(-p "$PORT" -o BatchMode=yes)
SCP_OPTS=(-P "$PORT" -o BatchMode=yes)
if [ -n "$KEY" ]; then SSH_OPTS+=(-i "$KEY"); SCP_OPTS+=(-i "$KEY"); fi

SHA=$(git rev-parse --short HEAD 2>/dev/null || echo nocommit)
if [ "$COMMITTED" = 0 ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  REVISION="$SHA-dirty-$(date +%Y%m%d%H%M%S)"
else
  REVISION="$SHA"
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/farmgo-$REVISION.tar.gz"

say "packing $REVISION"
if [ "$COMMITTED" = 1 ]; then
  git rev-parse HEAD >/dev/null 2>&1 || die "no commits yet; ship the working tree instead (drop --committed)"
  git archive --format=tar HEAD >"$WORK/src.tar"
else
  git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf "$WORK/src.tar"
fi
echo "$REVISION" >"$WORK/REVISION"
tar -rf "$WORK/src.tar" -C "$WORK" REVISION
if [ "$WEB" = 1 ]; then
  [ -f apps/app/dist/index.html ] || die "apps/app/dist is missing; run: pnpm --filter @farmgo/app build:web"
  tar -rf "$WORK/src.tar" apps/app/dist
fi
gzip -c "$WORK/src.tar" >"$ARCHIVE"
say "archive is $(du -h "$ARCHIVE" | cut -f1)"

say "copying to $HOST"
scp "${SCP_OPTS[@]}" "$ARCHIVE" "$HOST:/tmp/farmgo-ship.tar.gz"

say "unpacking into $DIR"
# shellcheck disable=SC2087
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$DIR" "$WEB" <<'REMOTE'
set -euo pipefail
DIR=$1 WEB=$2
sudo_if() { if [ -w "$(dirname "$DIR")" ] || [ -w "$DIR" ]; then "$@"; else sudo "$@"; fi; }
sudo_if mkdir -p "$DIR"
sudo_if chown "$(id -u):$(id -g)" "$DIR"
NEW=$(mktemp -d)
tar -xzf /tmp/farmgo-ship.tar.gz -C "$NEW"
rm -f /tmp/farmgo-ship.tar.gz
# Keep the last web build when this ship does not carry one.
if [ "$WEB" = 0 ] && [ -d "$DIR/apps/app/dist" ] && [ ! -d "$NEW/apps/app/dist" ]; then
  mkdir -p "$NEW/apps/app"
  cp -a "$DIR/apps/app/dist" "$NEW/apps/app/dist"
fi
chmod +x "$NEW"/infra/*.sh "$NEW"/infra/observability/*.sh 2>/dev/null || true
# Update in place, never by swapping directories: running containers bind-mount files and
# folders here (Caddyfile, backups, the web build), and must keep seeing the same paths and inodes.
# --inplace rewrites changed files without replacing them, so a Caddy reload sees the new config.
command -v rsync >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq rsync; }
rsync -a --inplace --delete   --exclude /infra/.env.production --exclude /infra/state/ --exclude /infra/backups/   --exclude /infra/observability/metrics_token   "$NEW/" "$DIR/"
rm -rf "$NEW"
echo "now at $(cat "$DIR/REVISION")"
REMOTE

if [ "$DEPLOY" = 1 ]; then
  say "deploying on $HOST"
  ssh "${SSH_OPTS[@]}" -t "$HOST" "cd '$DIR' && infra/deploy.sh --build"
else
  say "shipped. To deploy: ssh $HOST 'cd $DIR && infra/deploy.sh --build'"
fi
