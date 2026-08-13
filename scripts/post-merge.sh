#!/bin/bash
set -e

echo "→ Installing dependencies..."
npm install --legacy-peer-deps

echo "→ Running database migrations (if DATABASE_URL is set)..."
if [ -n "$DATABASE_URL" ]; then
  npm run db:migrate
else
  echo "  Skipping migrations — DATABASE_URL not set"
fi

echo "→ Post-merge setup complete."
