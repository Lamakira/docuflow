#!/bin/bash
# Forwards Stripe webhooks to the local web app, listening on the account of
# the STRIPE_SECRET_KEY in .env rather than whichever account `stripe login`
# last chose, so the CLI and the app can never watch different accounts.
#   npm run stripe:listen
set -e

key=$(grep -E '^STRIPE_SECRET_KEY=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"'")
if [ -z "$key" ]; then
  echo "STRIPE_SECRET_KEY is not set in .env" >&2
  exit 1
fi

port=$(grep -E '^PORT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"'")
port=${port:-5000}

echo "→ Forwarding Stripe webhooks to http://localhost:$port/api/billing/webhooks"
echo "  Copy the whsec_… secret printed below into STRIPE_WEBHOOK_SECRET if it differs, then restart the app."
exec stripe listen --api-key "$key" --forward-to "localhost:$port/api/billing/webhooks"
