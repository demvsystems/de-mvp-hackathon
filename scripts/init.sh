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

container_for_port() {
  port="$1"

  docker ps --format '{{.Names}} {{.Ports}}' | while IFS= read -r line; do
    case "$line" in
      *"127.0.0.1:${port}->"* | *"0.0.0.0:${port}->"* | *"[::]:${port}->"*)
        printf "%s\n" "${line%% *}"
        break
        ;;
    esac
  done
}

wait_for_container() {
  container_ref="$1"
  label="$2"
  printf "Waiting for %s" "$label"

  attempts=0
  while [ "$attempts" -lt 60 ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_ref" 2>/dev/null || true)"

    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      printf "\n"
      return 0
    fi

    attempts=$((attempts + 1))
    printf "."
    sleep 1
  done

  printf "\n%s did not become healthy in time.\n" "$label" >&2
  exit 1
}

wait_for_service() {
  service_name="$1"
  printf "Waiting for %s" "$service_name"

  attempts=0
  while [ "$attempts" -lt 60 ]; do
    container_id="$(compose ps -q "$service_name" 2>/dev/null || true)"

    if [ -n "$container_id" ]; then
      printf "\n"
      wait_for_container "$container_id" "$service_name"
      return 0
    fi

    attempts=$((attempts + 1))
    printf "."
    sleep 1
  done

  printf "\n%s did not become healthy in time.\n" "$service_name" >&2
  exit 1
}

start_service() {
  service_name="$1"
  port="$2"
  port_owner="$(container_for_port "$port")"

  if [ -n "$port_owner" ]; then
    echo "Port $port is already in use by $port_owner; reusing it for $service_name."
    wait_for_container "$port_owner" "$service_name"
    return 0
  fi

  compose up -d "$service_name"
  wait_for_service "$service_name"
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
else
  echo ".env already exists."
fi

set -a
. ./.env
set +a

CI=true pnpm install --no-frozen-lockfile

start_service postgres 54329
start_service nats 4222

pnpm db:push

echo "Init complete. Run pnpm dev to start the apps."
