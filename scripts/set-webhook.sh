#!/usr/bin/env bash
# Set the Telegram webhook from local secrets in .dev.vars (never committed).
# Usage: npm run webhook
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .dev.vars ]; then
  echo "Missing .dev.vars — copy .dev.vars.example to .dev.vars and fill it in."
  echo "Never commit .dev.vars; production secrets live in Cloudflare (wrangler secret put)."
  exit 1
fi

set -a
. ./.dev.vars
set +a

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN missing in .dev.vars}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET missing in .dev.vars}"
: "${WORKER_URL:?WORKER_URL missing in .dev.vars (e.g. https://hamara.<subdomain>.workers.dev)}"

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${WORKER_URL}/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
echo
