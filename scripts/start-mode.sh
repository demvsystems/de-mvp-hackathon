#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in
  mock|demo|full) ;;
  *)
    echo "usage: $0 <mock|demo|full>" >&2
    exit 2
    ;;
esac

if [ ! -f .env ]; then
  echo ".env missing — run pnpm init:dev first." >&2
  exit 1
fi

set -a
. ./.env
set +a

# Per-mode DATABASE_URL: prefer DATABASE_URL_<MODE> from .env, otherwise derive
# `de_mvp_<mode>` on the same server as the base DATABASE_URL.
case "$MODE" in
  mock) MODE_URL="${DATABASE_URL_MOCK:-}" ;;
  demo) MODE_URL="${DATABASE_URL_DEMO:-}" ;;
  full) MODE_URL="${DATABASE_URL_FULL:-}" ;;
esac

if [ -z "$MODE_URL" ]; then
  : "${DATABASE_URL:?DATABASE_URL not set}"
  BASE="${DATABASE_URL%/*}"
  MODE_URL="$BASE/de_mvp_$MODE"
fi

DB_NAME="${MODE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"
SERVER_URL="${MODE_URL%/*}/postgres"

echo "[start-mode] mode=$MODE db=$DB_NAME"

psql "$SERVER_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
  | grep -q 1 \
  || psql "$SERVER_URL" -c "CREATE DATABASE \"$DB_NAME\""

psql "$MODE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null

DATABASE_URL="$MODE_URL" pnpm --filter @repo/db exec drizzle-kit push --force >/dev/null

export DATABASE_URL="$MODE_URL"

case "$MODE" in
  mock)
    pnpm db:preseed-topics
    pnpm db:mock-assess
    # Backend runs with no workers so the dashboard's control panel has a
    # control server to talk to (avoids "backend unreachable" errors).
    export BACKEND_WORKERS=
    exec pnpm -r --parallel --filter "./apps/web-playground" --filter "./apps/backend" dev
    ;;
  demo)
    # Phase 1: hydrate fixtures into `records` via the real pipeline so preseed
    # can resolve member IDs. Backend exits once the materializer + mention-
    # extractor consumers have caught up to the last seq the connectors published.
    BACKEND_WORKERS=connectors,materializer,mention-extractor \
      pnpm --filter @repo/backend start -- --hydrate-and-exit
    pnpm db:preseed-topics -- --preserve-assessments
    # Phase 2: long-running demo. No connectors needed — fixtures are already
    # materialized; re-running them would just be no-ops via msgID dedup.
    export PORT=3001
    export NEXT_DIST_DIR=.next-demo
    export BACKEND_WORKERS=materializer,mention-extractor
    exec pnpm -r --parallel --filter "./apps/web" --filter "./apps/backend" dev
    ;;
  full)
    export PORT=3002
    export NEXT_DIST_DIR=.next-full
    export BACKEND_WORKERS=connectors,embedder,materializer,mention-extractor,topic-discovery
    exec pnpm -r --parallel --filter "./apps/web" --filter "./apps/backend" dev
    ;;
esac
