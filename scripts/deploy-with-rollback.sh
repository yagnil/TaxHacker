#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
ENV_FILE=${ENV_FILE:-.env}
APP_SERVICE=${APP_SERVICE:-app}
STACK_SERVICES=${STACK_SERVICES:-postgres app}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <image-tag-or-full-image>" >&2
  echo "Example: $0 ghcr.io/yagnil/taxhacker:v0.5.6" >&2
  exit 1
fi

TARGET_IMAGE=$1

cd "$PROJECT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

current_auth_secret() {
  sed -n 's/^BETTER_AUTH_SECRET="\{0,1\}\(.*\)"\{0,1\}$/\1/p' "$ENV_FILE" | tail -n 1
}

validate_auth_secret() {
  secret=$(current_auth_secret || true)

  if [ -z "$secret" ]; then
    echo "BETTER_AUTH_SECRET is missing from $ENV_FILE" >&2
    exit 1
  fi

  if [ "${#secret}" -lt 32 ]; then
    echo "BETTER_AUTH_SECRET in $ENV_FILE must be at least 32 characters long." >&2
    echo "Generate one with: openssl rand -base64 32" >&2
    exit 1
  fi
}

validate_auth_secret

BACKUP_FILE=$(mktemp "${TMPDIR:-/tmp}/taxhacker-env.XXXXXX")
cp "$ENV_FILE" "$BACKUP_FILE"

current_image() {
  sed -n 's/^TAXHACKER_IMAGE="\{0,1\}\(.*\)"\{0,1\}$/\1/p' "$ENV_FILE" | tail -n 1
}

set_target_image() {
  target=$1
  temp_file=$(mktemp "${TMPDIR:-/tmp}/taxhacker-target.XXXXXX")

  awk -v image="$target" '
    BEGIN { updated = 0 }
    /^TAXHACKER_IMAGE=/ {
      print "TAXHACKER_IMAGE=\"" image "\""
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print ""
        print "TAXHACKER_IMAGE=\"" image "\""
      }
    }
  ' "$ENV_FILE" > "$temp_file"

  mv "$temp_file" "$ENV_FILE"
}

wait_for_healthy() {
  service=$1
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))

  while [ "$(date +%s)" -lt "$deadline" ]; do
    container_id=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service")

    if [ -z "$container_id" ]; then
      sleep 2
      continue
    fi

    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")

    case "$status" in
      healthy)
        return 0
        ;;
      exited|dead|unhealthy)
        return 1
        ;;
      *)
        sleep 2
        ;;
    esac
  done

  return 1
}

rollback() {
  echo "Deployment failed. Restoring previous image..." >&2
  cp "$BACKUP_FILE" "$ENV_FILE"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull $STACK_SERVICES || true
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d $STACK_SERVICES
  wait_for_healthy "$APP_SERVICE" || true
}

PREVIOUS_IMAGE=$(current_image || true)

echo "Deploying $TARGET_IMAGE"
if [ -n "$PREVIOUS_IMAGE" ]; then
  echo "Previous image: $PREVIOUS_IMAGE"
fi

set_target_image "$TARGET_IMAGE"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull $STACK_SERVICES
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d $STACK_SERVICES

if ! wait_for_healthy "$APP_SERVICE"; then
  rollback
  rm -f "$BACKUP_FILE"
  exit 1
fi

rm -f "$BACKUP_FILE"
echo "Deployment succeeded and the app is healthy."