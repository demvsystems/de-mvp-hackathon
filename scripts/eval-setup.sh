#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env missing — run pnpm init:dev first." >&2
  exit 1
fi

set -a
. ./.env
set +a

: "${DATABASE_URL_EVAL:?Set DATABASE_URL_EVAL in .env (see .env.example).}"

# Extract dbname from the connection URL (last path segment).
EVAL_DB="${DATABASE_URL_EVAL##*/}"
EVAL_DB="${EVAL_DB%%\?*}"

# Server URL with no path → for CREATE DATABASE.
SERVER_URL="${DATABASE_URL_EVAL%/*}/postgres"

echo "Ensuring database '${EVAL_DB}' exists…"
psql "${SERVER_URL}" -tAc "SELECT 1 FROM pg_database WHERE datname = '${EVAL_DB}'" \
  | grep -q 1 \
  || psql "${SERVER_URL}" -c "CREATE DATABASE \"${EVAL_DB}\""

echo "Ensuring pgvector extension exists in ${EVAL_DB}…"
psql "${DATABASE_URL_EVAL}" -c "CREATE EXTENSION IF NOT EXISTS vector"

echo "Pushing schema against ${EVAL_DB}…"
DATABASE_URL="${DATABASE_URL_EVAL}" pnpm --filter @repo/db exec drizzle-kit push --force

echo "Verifying eval schema…"
psql "${DATABASE_URL_EVAL}" -tAc "
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
  AND to_regclass('public.embeddings') IS NOT NULL
  AND to_regclass('public.embeddings_vec_hnsw') IS NOT NULL
  AND to_regclass('public.topics_centroid') IS NOT NULL;
" | grep -q t

echo "Eval database ready."
