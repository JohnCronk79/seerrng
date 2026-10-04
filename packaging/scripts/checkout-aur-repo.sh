#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <aur-package-name> <target-dir>" >&2
  exit 1
fi

package_name="$1"
target_dir="$2"
[[ "$package_name" =~ ^[a-z0-9][a-z0-9@._+-]*$ ]] || {
  echo "ERROR: invalid AUR package name: $package_name" >&2
  exit 1
}
[[ "$target_dir" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && "$target_dir" != "." && "$target_dir" != ".." ]] || {
  echo "ERROR: target directory must be a safe relative directory name." >&2
  exit 1
}
read_url="https://aur.archlinux.org/${package_name}.git"
push_url="ssh://aur@aur.archlinux.org/${package_name}.git"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
aur_ssh_config="${AUR_SSH_CONFIG:-${HOME:?HOME is required}/.ssh/aur_config}"
[[ -f "$aur_ssh_config" && ! -L "$aur_ssh_config" ]] || {
  echo "ERROR: AUR SSH config is missing or unsafe: $aur_ssh_config" >&2
  exit 1
}
aur_git() {
  AUR_SSH_CONFIG="$aur_ssh_config" GIT_SSH="$script_dir/aur-ssh-command.sh" GIT_SSH_VARIANT=ssh git "$@"
}

for attempt in 1 2 3 4 5; do
  rm -rf -- "$target_dir"

  if git clone "$read_url" "$target_dir"; then
    (
      cd "$target_dir"
      git remote set-url --push origin "$push_url"
    )
    echo "Cloned AUR repo ${package_name} via HTTPS and configured SSH push."
    exit 0
  fi

  if aur_git -c init.defaultBranch=master clone "$push_url" "$target_dir"; then
    echo "Cloned new or existing AUR repo ${package_name} via SSH."
    exit 0
  fi

  if [[ "$attempt" -eq 5 ]]; then
    echo "ERROR: failed to clone AUR repo ${package_name} after ${attempt} attempts." >&2
    exit 1
  fi

  sleep_seconds=$((attempt * 2))
  echo "Clone failed for ${package_name}; retrying in ${sleep_seconds}s..." >&2
  sleep "$sleep_seconds"
done
