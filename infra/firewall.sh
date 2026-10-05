#!/usr/bin/env bash
# Host firewall for the FarmGo VPS: allow SSH (22), HTTP (80) and HTTPS (443, TCP and UDP for
# HTTP/3), deny everything else coming in. Run once as root:  sudo infra/firewall.sh
#
# Docker publishes ports through its own iptables rules, which bypass ufw. That is why the
# production compose file publishes only Caddy's 80 and 443, and binds Uptime Kuma to 127.0.0.1.
# Check with:  docker ps --format '{{.Names}} {{.Ports}}'
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

command -v ufw >/dev/null || { apt-get update && apt-get install -y ufw; }

# Allow SSH before turning the firewall on, so this session is not cut off.
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http (certificates and redirect)'
ufw allow 443/tcp comment 'https'
ufw allow 443/udp comment 'http3'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose

echo
echo "Published Docker ports (should be only 80 and 443, plus 127.0.0.1 bindings):"
docker ps --format '  {{.Names}}  {{.Ports}}' 2>/dev/null || echo "  (docker not running yet)"
