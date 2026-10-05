#!/usr/bin/env bash
# Shared-host mode, one-time HTTPS setup. Run on the server with sudo:
#
#   sudo infra/nginx/install-nginx.sh
#
# Reads API_DOMAIN, APP_DOMAIN, FILES_DOMAIN, ACME_EMAIL (optional) and CADDY_LOCAL_PORT from
# infra/.env.production, writes /etc/nginx/sites-available/farmgo (a new file, no other site is
# changed), checks the whole nginx config before reloading, then asks certbot for one
# certificate covering the three FarmGo hostnames only.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "infra/.env.production is missing"; exit 1; }
val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
API=$(val API_DOMAIN) APP=$(val APP_DOMAIN) FILES=$(val FILES_DOMAIN) EMAIL=$(val ACME_EMAIL)
PORT=$(val CADDY_LOCAL_PORT); PORT=${PORT:-8180}
for v in API APP FILES; do [ -n "${!v}" ] || { echo "$v is empty in $ENV_FILE"; exit 1; }; done

SITE=/etc/nginx/sites-available/farmgo
if [ -e "$SITE" ] && ! grep -q "FarmGo Connect in shared-host mode" "$SITE"; then
  echo "$SITE exists and is not FarmGo's; stopping without changes"; exit 1
fi
sed -e "s/__API_DOMAIN__/$API/" -e "s/__APP_DOMAIN__/$APP/" -e "s/__FILES_DOMAIN__/$FILES/" \
  -e "s/__CADDY_LOCAL_PORT__/$PORT/" nginx/farmgo.conf.template > "$SITE.new"
mv "$SITE.new" "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/farmgo

if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/farmgo
  echo "nginx rejected the config; the FarmGo site was disabled again and nothing was reloaded"
  exit 1
fi
systemctl reload nginx
# Without ACME_EMAIL, certbot reuses the account this server already has.
if [ -n "$EMAIL" ]; then CONTACT=(-m "$EMAIL"); else CONTACT=(--register-unsafely-without-email); fi
certbot --nginx --non-interactive --agree-tos "${CONTACT[@]}" --redirect \
  --cert-name farmgo -d "$API" -d "$APP" -d "$FILES"
echo "Done: https://$APP"
