#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 <repo-dir> <aur-package-name> <commit-message> [branch]" >&2
  exit 1
fi

repo_dir="$1"
package_name="$2"
commit_message="$3"
branch="${4:-master}"
[[ "$package_name" =~ ^[a-z0-9][a-z0-9@._+-]*$ ]] || {
  echo "ERROR: invalid AUR package name: $package_name" >&2
  exit 1
}
[[ "$branch" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$branch" != *..* && "$branch" != *//* && "$branch" != */ && "$branch" != *.lock ]] || {
  echo "ERROR: invalid AUR branch name: $branch" >&2
  exit 1
}
[[ -d "$repo_dir" && ! -L "$repo_dir" ]] || {
  echo "ERROR: repository directory is missing or unsafe: $repo_dir" >&2
  exit 1
}
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
aur_ssh_config="${AUR_SSH_CONFIG:-${HOME:?HOME is required}/.ssh/aur_config}"
[[ -f "$aur_ssh_config" && ! -L "$aur_ssh_config" ]] || {
  echo "ERROR: AUR SSH config is missing or unsafe: $aur_ssh_config" >&2
  exit 1
}
aur_git() {
  AUR_SSH_CONFIG="$aur_ssh_config" GIT_SSH="$script_dir/aur-ssh-command.sh" GIT_SSH_VARIANT=ssh git "$@"
}

cd "$repo_dir"

git config user.name "SeerrNG CI"
git config user.email "seerrng@proton.me"

git commit -m "$commit_message" || echo "No AUR changes to commit for ${package_name}."

for attempt in 1 2 3 4 5; do
  if aur_git push origin HEAD:"$branch"; then
    echo "Pushed to AUR: ${package_name}"
    exit 0
  fi

  if [[ "$attempt" -eq 5 ]]; then
    echo "ERROR: failed to push AUR repo ${package_name} after ${attempt} attempts." >&2
    exit 1
  fi

  sleep_seconds=$((attempt * 2))
  echo "Push failed for ${package_name}; rebasing and retrying in ${sleep_seconds}s..." >&2
  sleep "$sleep_seconds"
  aur_git fetch origin "$branch" && aur_git pull --rebase origin "$branch" || true
done
