#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  echo "docker-compose or docker compose is required." >&2
  exit 1
}

wait_for_service() {
  service_name="$1"
  printf "Waiting for %s" "$service_name"

  attempts=0
  while [ "$attempts" -lt 60 ]; do
    container_id="$(compose ps -q "$service_name" 2>/dev/null || true)"
    status=""

    if [ -n "$container_id" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    fi

    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      printf "\n"
      return 0
    fi

    attempts=$((attempts + 1))
    printf "."
    sleep 1
  done

  printf "\n%s did not become healthy in time.\n" "$service_name" >&2
  exit 1
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
else
  echo ".env already exists."
fi

CI=true pnpm install --no-frozen-lockfile

compose up -d

wait_for_service postgres
wait_for_service nats

pnpm db:push

echo "Init complete. Run pnpm dev to start the apps."
