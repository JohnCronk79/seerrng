#!/usr/bin/env bash
set -euo pipefail

HOST="${SEERRNG_DEPLOY_HOST:-kspls0}"
CONTAINER="${SEERRNG_CONTAINER_NAME:-seerr-host}"
PORT="${SEERRNG_PORT:-5055}"
EXPECTED_COMMIT="${1:-$(git rev-parse HEAD)}"

if [[ ! "$HOST" =~ ^[A-Za-z0-9][A-Za-z0-9_.:@%+-]{0,254}$ ]]; then
  echo "SEERRNG_DEPLOY_HOST contains invalid characters" >&2
  exit 2
fi
if [[ ! "$CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "SEERRNG_CONTAINER_NAME contains invalid characters" >&2
  exit 2
fi
if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]] ||
  ((10#$PORT < 1 || 10#$PORT > 65535)); then
  echo "SEERRNG_PORT must be an integer from 1 through 65535" >&2
  exit 2
fi
if [[ ! "$EXPECTED_COMMIT" =~ ^[a-fA-F0-9]{7,64}$ ]]; then
  echo "expected commit must be a hexadecimal Git object ID" >&2
  exit 2
fi

ssh -- "$HOST" bash -s -- "$CONTAINER" "$PORT" "$EXPECTED_COMMIT" <<'EOF'
set -euo pipefail
CONTAINER="$1"
PORT="$2"
EXPECTED_COMMIT="$3"

running="$(docker ps \
  --filter "name=^/${CONTAINER}$" \
  --filter "status=running" \
  --format '{{.Names}}')"
test "$running" = "$CONTAINER"

status_json="$(curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/v1/status")"
commit_tag="$(printf '%s' "$status_json" | jq -r '.commitTag')"
image_revision="$(docker inspect "$CONTAINER" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"

printf 'container=%s\n' "$CONTAINER"
printf 'status.commitTag=%s\n' "$commit_tag"
printf 'image.revision=%s\n' "$image_revision"
printf 'expected=%s\n' "$EXPECTED_COMMIT"

test "$commit_tag" = "$EXPECTED_COMMIT"
test "$image_revision" = "$EXPECTED_COMMIT"
EOF
