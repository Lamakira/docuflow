#!/bin/bash
# One terminal for local development: the database, the web app, and the
# Worker. Ctrl+C stops both processes; the database container keeps running.
#   npm run dev:all          database + web + Worker
#   npm run dev:all:web      database + web only
set -e

with_worker=1
[ "$1" = "--no-worker" ] && with_worker=0

echo "→ Starting the database..."
npm run --silent db:up

# `kill 0` signals the whole process group, so both servers and their
# prefixing pipes stop together, whichever one exits first.
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null' INT TERM EXIT

if [ "$with_worker" = 1 ]; then
  echo "→ Starting the Worker..."
  DOCUFLOW_ROLE=worker npm run --silent dev 2>&1 | sed -u 's/^/[worker] /' &
fi

echo "→ Starting the web app on http://localhost:5000 ..."
npm run --silent dev 2>&1 | sed -u 's/^/[web]    /' &

wait -n
