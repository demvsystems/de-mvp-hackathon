#!/usr/bin/env sh
# Boot all three modes side-by-side: web-playground/3000 (mock),
# web/3001 (demo), web/3002 (full). Each instance reads its own DATABASE_URL.
# No backend workers — start:demo / start:full launch those individually.
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env missing — run pnpm init:dev first." >&2
  exit 1
fi

set -a
. ./.env
set +a

resolve_url() {
  case "$1" in
    mock) echo "${DATABASE_URL_MOCK:-${DATABASE_URL%/*}/de_mvp_mock}" ;;
    demo) echo "${DATABASE_URL_DEMO:-${DATABASE_URL%/*}/de_mvp_demo}" ;;
    full) echo "${DATABASE_URL_FULL:-${DATABASE_URL%/*}/de_mvp_full}" ;;
  esac
}

ensure_db() {
  url="$1"
  db_name="${url##*/}"
  db_name="${db_name%%\?*}"
  server_url="${url%/*}/postgres"

  psql "$server_url" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_name'" \
    | grep -q 1 \
    || psql "$server_url" -c "CREATE DATABASE \"$db_name\""
  psql "$url" -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null
  DATABASE_URL="$url" pnpm --filter @repo/db exec drizzle-kit push --force >/dev/null
}

MOCK_URL="$(resolve_url mock)"
DEMO_URL="$(resolve_url demo)"
FULL_URL="$(resolve_url full)"

echo "[start-all] provisioning databases"
ensure_db "$MOCK_URL"
ensure_db "$DEMO_URL"
ensure_db "$FULL_URL"

echo "[start-all] preseeding topics"
DATABASE_URL="$MOCK_URL" pnpm db:preseed-topics
DATABASE_URL="$MOCK_URL" pnpm db:mock-assess
DATABASE_URL="$DEMO_URL" pnpm db:preseed-topics
DATABASE_URL="$FULL_URL" pnpm db:preseed-topics

# Forward Ctrl+C to all children so the terminal stays responsive.
pids=""
trap 'kill $pids 2>/dev/null || true; wait 2>/dev/null || true; exit 0' INT TERM

echo "[start-all] booting frontends: mock=3000 demo=3001 full=3002"

# Each frontend points at its own backend control server (no workers run in
# start:all; the backends exist purely so the dashboard's control panel works).
DATABASE_URL="$MOCK_URL" BACKEND_WORKERS= BACKEND_CONTROL_PORT=3100 \
  pnpm --filter @repo/backend dev &
pids="$pids $!"

DATABASE_URL="$DEMO_URL" BACKEND_WORKERS= BACKEND_CONTROL_PORT=3101 \
  pnpm --filter @repo/backend dev &
pids="$pids $!"

DATABASE_URL="$FULL_URL" BACKEND_WORKERS= BACKEND_CONTROL_PORT=3102 \
  pnpm --filter @repo/backend dev &
pids="$pids $!"

DATABASE_URL="$MOCK_URL" BACKEND_CONTROL_PORT=3100 \
  pnpm --filter @repo/web-playground dev &
pids="$pids $!"

DATABASE_URL="$DEMO_URL" BACKEND_CONTROL_PORT=3101 PORT=3001 NEXT_DIST_DIR=.next-demo \
  pnpm --filter @repo/web dev &
pids="$pids $!"

DATABASE_URL="$FULL_URL" BACKEND_CONTROL_PORT=3102 PORT=3002 NEXT_DIST_DIR=.next-full \
  pnpm --filter @repo/web dev &
pids="$pids $!"

wait
