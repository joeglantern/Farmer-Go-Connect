#!/usr/bin/env bash
# Writes the Prometheus scrape token from METRICS_TOKEN in infra/.env.production.
# The file is git-ignored and readable only by its owner and the Prometheus container.
set -euo pipefail
cd "$(dirname "$0")"
token=$(grep -E '^METRICS_TOKEN=' ../.env.production | cut -d= -f2-)
[ -n "$token" ] || { echo "METRICS_TOKEN is empty in infra/.env.production" >&2; exit 1; }
umask 077
printf '%s' "$token" > metrics_token
# Prometheus runs as user nobody (65534) in its image.
chown 65534:65534 metrics_token 2>/dev/null || chmod 644 metrics_token
echo "wrote infra/observability/metrics_token"
