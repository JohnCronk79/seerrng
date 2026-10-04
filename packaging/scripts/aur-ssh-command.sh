#!/usr/bin/env bash
set -euo pipefail

config="${AUR_SSH_CONFIG:-${HOME:?HOME is required}/.ssh/aur_config}"
[[ -f "$config" && ! -L "$config" ]] || {
  echo "ERROR: AUR SSH config is missing or unsafe: $config" >&2
  exit 1
}

exec ssh -F "$config" "$@"
