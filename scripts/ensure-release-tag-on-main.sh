#!/usr/bin/env bash
set -euo pipefail

tag="${1:?usage: ensure-release-tag-on-main.sh <tag>}"
git fetch --no-tags origin main
sha="$(git rev-list -n 1 "$tag")"
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "Release tags must point at commits contained in origin/main." >&2
  exit 1
fi
