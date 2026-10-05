#!/bin/sh
# Off-site copies for FarmGo, run by the backup-offsite service (rclone image).
#
#   offsite.sh once   copy now and exit
#   offsite.sh loop   copy every day at OFFSITE_HOUR (default 03:00 Nairobi), after the 02:00 dump
#
# What it copies to s3://$OFFSITE_S3_BUCKET:
#   postgres/   every dump in /backups (daily, weekly, monthly). Copies only: nothing off-site is
#               deleted here, so set a lifecycle rule on the bucket (for example expire after 200 days).
#   files/<b>/  every MinIO bucket, synced (files deleted locally are deleted off-site too, after
#               being kept for OFFSITE_KEEP_DELETED_DAYS in files-deleted/<date>/).
#   last-success.txt  the time of the last complete run, for monitoring.
#
# Needs OFFSITE_S3_ENDPOINT, OFFSITE_S3_BUCKET, OFFSITE_S3_ACCESS_KEY, OFFSITE_S3_SECRET_KEY,
# and the local S3_ACCESS_KEY and S3_SECRET_KEY. Works with any S3-compatible store
# (Backblaze B2, Wasabi, Cloudflare R2, AWS S3, a MinIO elsewhere).
set -eu

log() { echo "{\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"service\":\"backup-offsite\",\"msg\":\"$*\"}"; }

configure() {
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER="${OFFSITE_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="$OFFSITE_S3_ENDPOINT"
  export RCLONE_CONFIG_OFFSITE_REGION="${OFFSITE_S3_REGION:-us-east-1}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$OFFSITE_S3_ACCESS_KEY"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$OFFSITE_S3_SECRET_KEY"
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  if [ -n "${OFFSITE_S3_SSE:-}" ]; then export RCLONE_CONFIG_OFFSITE_SERVER_SIDE_ENCRYPTION="$OFFSITE_S3_SSE"; fi

  export RCLONE_CONFIG_LOCAL_TYPE=s3
  export RCLONE_CONFIG_LOCAL_PROVIDER=Minio
  export RCLONE_CONFIG_LOCAL_ENDPOINT="${LOCAL_S3_ENDPOINT:-http://minio:9000}"
  export RCLONE_CONFIG_LOCAL_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export RCLONE_CONFIG_LOCAL_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
}

run_once() {
  bucket="$OFFSITE_S3_BUCKET"
  stamp=$(date -u +%Y%m%d)
  log "copying database dumps"
  rclone copy /backups "offsite:$bucket/postgres" --include "*.dump" --include "*.sql.gz" --transfers 2 --stats-one-line --stats 0
  for b in $(rclone lsf local: --dirs-only | tr -d '/'); do
    # When the off-site store is the same MinIO (a test), never copy the backup bucket into itself.
    [ "$b" = "$bucket" ] && continue
    log "syncing bucket $b"
    rclone sync "local:$b" "offsite:$bucket/files/$b" \
      --backup-dir "offsite:$bucket/files-deleted/$stamp/$b" --transfers 4 --stats 0
  done
  keep="${OFFSITE_KEEP_DELETED_DAYS:-30}"
  rclone delete "offsite:$bucket/files-deleted" --min-age "${keep}d" --rmdirs 2>/dev/null || true
  date -u +%Y-%m-%dT%H:%M:%SZ | rclone rcat "offsite:$bucket/last-success.txt"
  log "off-site copy complete"
}

if [ -z "${OFFSITE_S3_ENDPOINT:-}" ] || [ -z "${OFFSITE_S3_BUCKET:-}" ]; then
  log "off-site backups are off: set OFFSITE_S3_ENDPOINT and OFFSITE_S3_BUCKET in infra/.env.production"
  if [ "${1:-loop}" = loop ]; then
    while true; do sleep 86400; done
  fi
  exit 1
fi
configure

case "${1:-loop}" in
  once) run_once ;;
  loop)
    hour="${OFFSITE_HOUR:-3}"
    while true; do
      now=$(date +%s)
      today=$(date +%Y-%m-%d)
      next=$(date -d "$today $hour:00:00" +%s 2>/dev/null || echo $((now + 86400)))
      [ "$next" -le "$now" ] && next=$((next + 86400))
      log "next off-site copy in $(((next - now) / 60)) minutes"
      sleep $((next - now))
      run_once || log "off-site copy FAILED; will retry tomorrow"
    done
    ;;
  *) echo "usage: offsite.sh once|loop" >&2; exit 2 ;;
esac
