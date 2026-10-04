#!/usr/bin/env bash
set -euo pipefail

require_provenance=0
if [[ "${1:-}" == '--require-provenance' ]]; then
  require_provenance=1
  shift
fi
image_ref="${1:?usage: verify-container-manifest.sh [--require-provenance] <image-ref> [platform ...]}"
shift

if (($# == 0)); then
  set -- linux/amd64 linux/arm64
fi

command -v docker >/dev/null 2>&1 || {
  echo 'docker is required to verify a container manifest.' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo 'jq is required to verify a container manifest.' >&2
  exit 1
}

raw_manifest=''
max_attempts=5
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if raw_manifest="$(docker buildx imagetools inspect --raw "$image_ref")"; then
    break
  fi
  if ((attempt == max_attempts)); then
    echo "Unable to inspect ${image_ref} after ${max_attempts} attempts." >&2
    exit 1
  fi
  delay_seconds=$((2 ** (attempt - 1)))
  echo "Manifest inspection failed for ${image_ref}; retrying in ${delay_seconds}s." >&2
  sleep "$delay_seconds"
done
jq -e '.manifests | type == "array"' >/dev/null <<<"$raw_manifest" || {
  echo "${image_ref} is not a multi-platform OCI index." >&2
  exit 1
}

actual_platforms="$(jq -r '
  [.manifests[]
    | select(.platform.os? and .platform.architecture?)
    | select(.platform.os != "unknown" and .platform.architecture != "unknown")
    | (.platform.os + "/" + .platform.architecture
      + (if .platform.variant? then "/" + .platform.variant else "" end))]
  | unique
  | .[]
' <<<"$raw_manifest" | sort -u)"
expected_platforms="$(printf '%s\n' "$@" | sort -u)"

if ! diff -u <(printf '%s\n' "$expected_platforms") <(printf '%s\n' "$actual_platforms"); then
  echo "${image_ref} has an unexpected platform set." >&2
  exit 1
fi

if [[ "$require_provenance" -eq 1 ]]; then
  provenance_count="$(jq '[.manifests[]? | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest")] | length' <<<"$raw_manifest")"
  [[ "$provenance_count" -gt 0 ]] || {
    echo "${image_ref} has no BuildKit provenance attestation." >&2
    exit 1
  }
fi

echo "Verified ${image_ref}: ${actual_platforms//$'\n'/, }"
