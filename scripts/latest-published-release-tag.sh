#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:-}"
if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo 'GITHUB_REPOSITORY must identify the repository whose releases are being prepared.' >&2
  exit 2
fi

if ! latest_published_tag="$(
  gh api --paginate -X GET -f per_page=100 "repos/${repository}/releases" \
    --jq '.[] | select(.draft == false and .prerelease == false) | [.published_at, .tag_name] | @tsv' |
    LC_ALL=C sort |
    tail -n 1 |
    cut -f 2-
  )"; then
  echo "Unable to query published releases for ${repository}." >&2
  exit 1
fi

if [[ ! "$latest_published_tag" =~ ^v[0-9][0-9A-Za-z._+-]{0,126}$ ]]; then
  echo "Unable to determine the latest published release tag for ${repository}." >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${latest_published_tag}^{commit}" >/dev/null; then
  echo "Latest published release tag ${latest_published_tag} is missing from the local checkout." >&2
  exit 1
fi

printf '%s\n' "$latest_published_tag"
