#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/catalog-upstreams.sh [--fetch]

Catalog this repository's upstreams, runtime pins, package manifests, container
images, release packaging pins, automation dependencies, and integration
surfaces.

Options:
  --fetch  Fetch each configured remote before reporting fork status. A failed
           remote fetch is reported but does not stop the catalog.
  -h, --help
           Show this help.
EOF
}

fetch=0
while (($#)); do
  case "$1" in
    --fetch)
      fetch=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

section() {
  printf '\n## %s\n\n' "$1"
}

subsection() {
  printf '\n### %s\n\n' "$1"
}

run_optional() {
  "$@" || true
}

print_file_if_present() {
  local file="$1"
  if [[ -f "$file" ]]; then
    subsection "$file"
    sed 's/^/  /' "$file"
    printf '\n'
  fi
}

remote_default_ref() {
  local remote="$1"
  local symbolic

  symbolic="$(git symbolic-ref --quiet --short "refs/remotes/${remote}/HEAD" 2>/dev/null || true)"
  if [[ -n "$symbolic" ]]; then
    printf '%s\n' "$symbolic"
    return
  fi

  for branch in main master; do
    if git show-ref --quiet --verify "refs/remotes/${remote}/${branch}"; then
      printf '%s/%s\n' "$remote" "$branch"
      return
    fi
  done

  printf '%s/main\n' "$remote"
}

remote_report_ref() {
  local remote="$1"
  local current_branch="$2"

  if [[ "$remote" == "upstream" ]]; then
    remote_default_ref "$remote"
    return
  fi

  if [[ -n "$current_branch" ]] && git show-ref --quiet --verify "refs/remotes/${remote}/${current_branch}"; then
    printf '%s/%s\n' "$remote" "$current_branch"
    return
  fi

  remote_default_ref "$remote"
}

if [[ "$fetch" -eq 1 ]]; then
  for remote in $(git remote); do
    if ! git fetch "$remote" --tags --prune; then
      printf 'warning: failed to fetch remote %s\n' "$remote" >&2
    fi
  done
fi

section "Git remotes and fork status"
current_branch="$(git branch --show-current 2>/dev/null || true)"
printf 'repo_root: %s\n' "$repo_root"
printf 'current_branch: %s\n' "$current_branch"
printf 'head: %s\n\n' "$(git rev-parse --short=12 HEAD)"

git remote -v | sort
printf '\n'

for remote in upstream origin gitlab; do
  if git remote get-url "$remote" >/dev/null 2>&1; then
    head_ref="$(remote_default_ref "$remote")"
    report_ref="$(remote_report_ref "$remote" "$current_branch")"
    printf '%s_default_ref: %s\n' "$remote" "$head_ref"
    printf '%s_report_ref: %s\n' "$remote" "$report_ref"
    if git show-ref --quiet --verify "refs/remotes/${report_ref}"; then
      counts="$(git rev-list --left-right --count "HEAD...${report_ref}")"
      ahead="${counts%%$'\t'*}"
      behind="${counts##*$'\t'}"
      printf '%s_divergence_from_HEAD: behind=%s ahead=%s\n' "$remote" "$behind" "$ahead"
    else
      printf '%s_divergence_from_HEAD: unknown; run with --fetch or check remote branch name\n' "$remote"
    fi

    if [[ "$remote" == "upstream" ]] && [[ "$report_ref" != "upstream/main" ]] && git show-ref --quiet --verify "refs/remotes/upstream/main"; then
      counts="$(git rev-list --left-right --count "HEAD...upstream/main")"
      ahead="${counts%%$'\t'*}"
      behind="${counts##*$'\t'}"
      printf 'upstream_main_divergence_from_HEAD: behind=%s ahead=%s\n' "$behind" "$ahead"
    fi
  fi
done

section "Package manifests"
node <<'NODE'
const fs = require('node:fs');

const manifests = [
  'package.json',
  'gen-docs/package.json',
  'bin/duplicate-detector/package.json',
];

const groups = [
  ['dependencies', 'dependencies'],
  ['devDependencies', 'devDependencies'],
  ['peerDependencies', 'peerDependencies'],
  ['optionalDependencies', 'optionalDependencies'],
];

for (const file of manifests) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`### ${file}`);
  console.log(`name: ${pkg.name ?? '(unnamed)'}`);
  console.log(`version: ${pkg.version ?? '(none)'}`);
  console.log(`packageManager: ${pkg.packageManager ?? '(none)'}`);
  if (pkg.engines) {
    for (const [name, value] of Object.entries(pkg.engines).sort()) {
      console.log(`engine.${name}: ${value}`);
    }
  }
  for (const [field, label] of groups) {
    const deps = pkg[field];
    if (!deps) continue;
    const entries = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b));
    console.log(`${label}_count: ${entries.length}`);
    for (const [name, version] of entries) {
      console.log(`  ${name}: ${version}`);
    }
  }
  console.log('');
}
NODE

section "pnpm workspaces, overrides, patches, and lockfiles"
print_file_if_present "pnpm-workspace.yaml"
print_file_if_present "gen-docs/pnpm-workspace.yaml"
print_file_if_present "bin/duplicate-detector/pnpm-workspace.yaml"

subsection "Lockfiles"
run_optional git ls-files '*pnpm-lock.yaml'

section "Runtime and container pins"
subsection "Dockerfile FROM lines"
run_optional git grep -nE '^FROM[[:space:]]+' -- 'Dockerfile*'

subsection "Compose and workflow container images"
run_optional git grep -nE '^[[:space:]]*(image|container):[[:space:]]+' -- '*.yml' '*.yaml'

subsection "Registry image references"
run_optional git grep -nE '(public\.ecr\.aws|ghcr\.io|docker\.io|quay\.io|node:[0-9]|postgres:[0-9]|alpine:[0-9]|ubuntu:[0-9]|fedora:[0-9]|archlinux:|busybox)' -- \
  '.github' '.gitlab-ci.yml' 'Dockerfile' 'Dockerfile.local' 'compose.yaml' 'compose.postgres.yaml' 'deploy' 'packaging' 'charts'

section "Automation dependencies"
subsection "GitHub Action refs"
run_optional git grep -nE '^[[:space:]]*uses:[[:space:]]+' -- '.github/workflows'

subsection "Renovate and Dependabot policy"
run_optional git grep -nE '(extends:|customManagers:|packageRules:|matchManagers:|package-ecosystem:|lockFileMaintenance:|pinDigests:|minimumReleaseAge:|postUpdateOptions:)' -- \
  '.github/renovate.json5' '.github/renovate' '.github/dependabot.yml'

section "Packaging and distribution pins"
run_optional git grep -nE '^(version:|appVersion:|base:|runtime:|runtime-version:|grade:|Name:|Version:|Requires:|Depends:|depends=|source=|GITHUB_REPOSITORY=|GHCR_IMAGE=|DOCKERHUB_IMAGE=|SNAP_NAME=|HELM_CHART=|FLATPAK_MANIFEST=)' -- \
  'charts' 'packaging'

section "External integration surfaces"
subsection "server/api providers"
run_optional git ls-files 'server/api/**' | awk -F/ 'NF >= 3 {print $3}' | sort -u

subsection "server/lib/scanners providers"
run_optional git ls-files 'server/lib/scanners/**' | awk -F/ 'NF >= 4 {print $4}' | sort -u

subsection "service assets"
run_optional git ls-files 'src/assets/services/**' | sed 's#^src/assets/services/##' | sort

section "Recommended next commands"
cat <<'EOF'
Fork sync:
  git fetch --all --tags --prune
  git switch -c sync/upstream-$(date +%Y%m%d) main
  git merge --no-ff upstream/HEAD

Root app dependencies:
  corepack enable
  pnpm install --frozen-lockfile
  pnpm outdated

Docs app dependencies:
  (cd gen-docs && corepack enable && pnpm install --frozen-lockfile && pnpm outdated)

Duplicate detector dependencies:
  (cd bin/duplicate-detector && corepack enable && pnpm install --frozen-lockfile && pnpm outdated)

Validation after dependency or upstream merges:
  pnpm format:check
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
EOF
