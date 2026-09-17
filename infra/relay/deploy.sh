#!/usr/bin/env bash
# Deploy the LIVETAP relay to a fresh host, in one command.
#
#   bash infra/relay/deploy.sh root@203.0.113.10 relay.yourdomain.com
#
# What it needs from you, and nothing else:
#   - a host you can SSH into as root (any small VPS; 1 vCPU / 1 GB is enough for a few sessions)
#   - a DNS A record pointing `relay.yourdomain.com` at that host, already propagated
#   - ports 80 and 443 TCP reachable, and UDP 18189 open in the provider's firewall
#
# It does NOT purchase anything, create an account, or touch your platform credentials.
#
# WHY THE SECRETS ARE GENERATED ON THE HOST. The three MediaMTX passwords are never seen by this
# machine, never printed, and never written to the repository. They are created by `openssl` on the
# server, land only in `/opt/livetap-relay/.env` with 600 permissions, and the one value the web
# app needs is read back over SSH at the end rather than echoed into a terminal scrollback.
set -euo pipefail

HOST="${1:-}"
DOMAIN="${2:-}"
REMOTE_DIR="/opt/livetap-relay"

if [ -z "$HOST" ] || [ -z "$DOMAIN" ]; then
  echo "usage: bash infra/relay/deploy.sh <ssh-target> <relay-domain>" >&2
  echo "       bash infra/relay/deploy.sh root@203.0.113.10 relay.yourdomain.com" >&2
  exit 2
fi

case "$DOMAIN" in
  localhost|127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*)
    echo "refusing: '$DOMAIN' is not a public name. A browser cannot publish to it." >&2
    exit 2
    ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { echo "[relay] $*"; }

say "target  $HOST"
say "domain  $DOMAIN"

# ------------------------------------------------------------------ 1. the host
say "1/6 checking the host"
ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" 'true' \
  || { echo "cannot SSH to $HOST with key auth." >&2; exit 1; }

ssh "$HOST" 'command -v docker >/dev/null' || {
  say "    docker is not installed; installing it"
  ssh "$HOST" 'curl -fsSL https://get.docker.com | sh'
}

# ---------------------------------------------------------------- 2. the stack
say "2/6 copying the relay stack"
ssh "$HOST" "mkdir -p $REMOTE_DIR/session-api"
scp -q "$HERE/docker-compose.yml" "$HERE/mediamtx.yml" "$HERE/Caddyfile" "$HOST:$REMOTE_DIR/"
scp -q "$HERE/session-api/relay-session.mjs" "$HOST:$REMOTE_DIR/session-api/"

# -------------------------------------------------------------- 3. the secrets
# Written only if absent, so re-running this script never rotates a live relay's credentials and
# never invalidates the token the deployed web app is already using.
say "3/6 generating secrets on the host (never printed, never leaves it)"
ssh "$HOST" "REMOTE_DIR=$REMOTE_DIR DOMAIN=$DOMAIN bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
if [ ! -f .env ]; then
  umask 077
  {
    echo "MTX_PUBLISH_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"
    echo "MTX_API_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"
    echo "MTX_HOOK_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"
    echo "LIVETAP_RELAY_DOMAIN=$DOMAIN"
    echo "LIVETAP_RELAY_PUBLIC_HOST=$DOMAIN"
    echo "LIVETAP_RELAY_PUBLIC_WHIP_SCHEME=https"
    echo "LIVETAP_RELAY_PUBLIC_WHIP_PORT=443"
  } > .env
  chmod 600 .env
  echo "[relay]     new secrets written to $REMOTE_DIR/.env (0600)"
else
  echo "[relay]     .env already exists; leaving the existing secrets alone"
fi
REMOTE

# ------------------------------------------------------------------- 4. run it
say "4/6 starting the stack with TLS"
ssh "$HOST" "cd $REMOTE_DIR && docker compose --profile tls up -d --remove-orphans"

# ------------------------------------------------------------------ 5. settle
say "5/6 waiting for the certificate and the health endpoint"
for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$DOMAIN/healthz" >/dev/null 2>&1; then
    say "    healthy after $((i * 10))s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "relay did not become healthy within 5 minutes." >&2
    echo "check: ssh $HOST 'cd $REMOTE_DIR && docker compose logs --tail=80 caddy session-api'" >&2
    exit 1
  fi
  sleep 10
done

# ------------------------------------------------------------------- 6. verify
say "6/6 verifying it the same way the release gate does"
TOKEN="$(ssh "$HOST" "grep '^MTX_PUBLISH_PASSWORD=' $REMOTE_DIR/.env | cut -d= -f2-")"
LIVETAP_RELAY_TOKEN="$TOKEN" node "$HERE/verify-relay.mjs" "https://$DOMAIN" || {
  echo "the relay is up but did not pass verification; see the failures above." >&2
  exit 1
}
unset TOKEN

cat <<EOF

[relay] DEPLOYED.  https://$DOMAIN

Point the web app at it. The token is a RELAY credential, not a platform secret, and is
compiled into the browser bundle by design (see README, "Publish authentication"):

  cd apps/web
  vercel env add VITE_LIVETAP_RELAY_URL production     # https://$DOMAIN
  ssh $HOST "grep '^MTX_PUBLISH_PASSWORD=' $REMOTE_DIR/.env | cut -d= -f2-" \\
    | vercel env add VITE_LIVETAP_RELAY_TOKEN production
  VITE_LIVETAP_MOCK_MODE=false npx vercel build --prod && npx vercel deploy --prebuilt --prod

Then go live from the browser. Nothing in this script has touched a platform account.
EOF
