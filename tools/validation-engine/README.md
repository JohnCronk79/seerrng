# SeerrNG validation engine

This is the authoritative operating guide for Vroom as used by this repository.
Use the existing `validate:development` entry point. Do not create another
launcher, runner, frozen inventory, or copied test bundle.

`vroom-app.cfg` is the sole authority for SeerrNG's four workload lists: `dev`,
`compile`, `pre-pr`, and `github`. When a required check is added, removed, or
reassigned, edit `vroom-app.cfg`. Do not maintain a second workload list in this
guide, `AGENTS.md`, package scripts, workflow YAML, launcher code, or Vroom
source. Package scripts and workflows may implement commands and native runner
environments referenced by the configuration; they do not decide workload
membership.

The engine owns discovery, execution topology, worker selection, candidate
binding, and result accounting. Existing native test runners, commands, action
pins, runner environments, assertions, and fixtures remain authoritative within
that plan.

## Developer commands

Run from the repository root:

```text
pnpm validate:development --help
pnpm validate:development --plan
pnpm validate:development --plan --json
pnpm validate:development
pnpm validate:development --compile
pnpm validate:development --pre-pr
```

- `--help` prints the exact supported modes without reading the project or
  creating files.
- `--plan` is read-only. It reports current discovery, native ownership,
  commands, exclusions, and staged coverage.
- With no mode flag, Vroom selects `[dev]` for ordinary development and preview
  work.
- `--compile` selects `[compile]` for a production compilation without the full
  pre-PR workload.
- `--pre-pr` selects `[pre-pr]` for the complete local validation and production
  compilation performed before a pull request.
- Internal `--github-*` bindings select `[github]`; they are not manual local
  modes.

A reviewed host may supply containment and proof callbacks to the bound engine
APIs. It may provide mounts, disposable fixtures, network boundaries, and
durable evidence storage. It must not rediscover tests, choose substitute
commands, alter planned dependencies, reinterpret results, or decide that an
incomplete run passed.

There is no public worker-count option. Internal host overrides exist only for
reviewed engine integration and tests; ordinary baselines must use automatic
capacity selection.

The `--github-*` modes shown by `--help` are internal GitHub Actions bindings,
not manual replacements for the local commands.

## Test discovery and ownership

Tests remain in their repository-owned locations and native formats. The
selected `vroom-app.cfg` section determines which SeerrNG checks are required.
Within those selected checks, hosted discovery assigns every supported test file
exactly once to one of these native lanes:

- Vitest through `pnpm test:ci`;
- registered tooling through the existing `pnpm security:council` command and
  its exact one-time `pnpm test:tooling` call;
- native unregistered `node:test` MJS files through the engine-owned Node lane;
- documentation security through `gen-docs` and `pnpm test:security`;
- Cypress specifications through the existing pinned Cypress action.

The plan records each file and its source digest. Added or removed tests change
the inventory. Duplicate ownership, missing registered files, unsupported test
formats, unclassified files, empty required lanes, or native command drift fail
closed. Use the current JSON plan for live counts; do not preserve a frozen
inventory in the repository.

Normal `test`, `test:vitest`, `test:ci`, and `test:tooling` commands remain
native. Their engine bindings are configuration, not additional engine launches.

## Local staged execution

The local full gate has four ordered stages:

1. repository checks, native tests, and applicable supplemental checks;
2. CodeQL Actions and JavaScript analysis;
3. the guarded production build;
4. Cypress/browser validation using that run's successful build.

Stage ordering is an evidence barrier, not automatic suppression after every
earlier failure. Independent later stages may continue collecting diagnostics
after an earlier failure. A true data dependency still applies: browser
validation cannot run without its own successful same-run build. Any required
failure keeps the overall result failed.

Independent test files use isolated forks and fresh temporary configuration.
The known quiet Vitest owners run serially after the independent Vitest group.
Cypress remains one native browser process until safe isolated sharding is
proved.

Applicable supplemental checks include workflow and security contracts,
documentation, release contracts, the Jellyfin plugin and disposable smoke,
conditional Helm validation, and link checks. Missing required prerequisites
make the result incomplete or failed; discovery is never reported as execution.

Local staged execution does not reuse successful test results. Local build
reuse is limited to the successful build produced earlier in the same bound run
for the same candidate.

## Worker policy

Let `N` be the effective logical CPU capacity: the minimum of available logical
CPUs, visible logical CPUs, and any applicable cgroup quota.

- ordinary local execution uses `max(1, N - 1)`;
- approved local `JohnCronk79` Git identity uses `2N`;
- GitHub Actions uses exactly `N`, regardless of actor identity.

Worker values are capacity reservations, not claims about physical cores or the
number of operating-system threads visible during every command.

## GitHub Actions orchestration

For pull requests and pushes to `main`, the central CI workflow creates one
immutable plan bound to the repository, event, run ID, run attempt, execution
commit, tree, lockfile, changed files, workflow definitions, and complete test
inventory.

The `[github]` section of `vroom-app.cfg` supplies the logical validation-unit list;
workflow YAML must not independently add or remove validation units. The current
list contains 10 logical validation units. Their matrices expand
to exactly 20 runner cases: nine fixed cases, four Unit shards, and seven
Cypress shards. Repository checks, both CodeQL cases, the existing build and
supplemental jobs, and Cypress can therefore use independent runner machines
concurrently after planning. The four stage names remain coverage and timing
classifications; they are not hosted scheduling barriers.

Each hosted unit depends only on the immutable engine plan. Cypress preserves
its own same-job build and does not consume the separate Alpine production-build
job. Final reconciliation is the fan-in barrier and still rejects every
required failure, cancellation, missing result, or unexpected skip.

A committed timing profile from a named successful baseline is a scheduling
hint only. The engine uses deterministic longest-processing-time assignment,
accounts for Vitest's parallel and serial-only projects, uses a recorded p95
fallback for an unknown Vitest file, and uses the recorded maximum for an
unknown Cypress spec. The live inventory remains the sole authority for
coverage. Timing data can change placement but can never skip a test or satisfy
a result.

After a job completes the native setup required to establish its dependency and
runner identity, each applicable unit or matrix case:

1. downloads the immutable plan;
2. verifies the current candidate, workflows, and test inventory;
3. admits its exact planned unit and case;
4. executes its existing native work for the current attempt; an existing result
   can never satisfy admission;
5. preserves its sealed result, evidence manifest, and attempt-scoped ledger;
6. uploads those artifacts for reconciliation.

A successful execution creates the ledger's single success entry. Failed,
cancelled, or incomplete work leaves the ledger blank. A second admission for
the same unit/case fails closed instead of accepting the earlier result.
If native runner setup fails before engine admission, the GitHub job fails and
the missing required receipt makes final reconciliation fail closed; the native
job log remains the failure evidence. No pre-admission failure can be reported as
an engine success.

Each of the four unit-test cases preserves `pnpm test:ci`, materializing only its
planned Vitest subset into a runner-temporary configuration, and also runs its
planned native Node subset with exactly `N` effective workers. A successful
receipt requires the JUnit report to contain every assigned Vitest file exactly
once with active tests and no failures or errors. The engine-owned Node result
must match the same admission, worker capacity, inventory, and assignment. Each
planned native Node file runs in its own isolated process through an `N`-wide
engine pool and must produce a nonempty complete TAP hierarchy; the sealed
per-file reports, files, timings, case counts, and aggregate result must all
reconcile.

The existing Alpine production-build job remains intact. Each of the seven
Cypress cases separately performs one Ubuntu `pnpm cypress:build`, then the
pinned Cypress action runs only that case's planned spec subset against its
same-job build. Its native per-spec, case, attempt, and aggregate evidence must
close that assignment. No compiled build is transferred between different
runner environments.

Final reconciliation downloads the immutable plan and the complete current-
attempt admission, receipt, and ledger artifacts. It requires exactly one
successful sealed artifact set for every applicable unit case. It verifies the
planned artifact set and the candidate, workflow, command, test-inventory,
admission, result, and ledger bindings. GitHub's native job logs remain the
evidence for action-managed tool setup that is not itself safely reusable.
For every sharded lane, reconciliation also rejects missing, extra, or duplicate
files and requires the successful case results to cover the canonical lane
exactly once with active tests in aggregate.

Path- or event-inapplicable jobs must be skipped exactly as planned. Pull-request
title, template, and merge-conflict checks remain external GitHub metadata and
are not represented as engine-executed native work. Standalone scheduled or
manual reusable-workflow launches are native runs, not aggregate hosted-engine
passes.

## Test results and caches

Test-result reuse is disabled in every local and hosted mode. Every applicable
unit/case executes its native validation work for the current run attempt.
Admissions, receipts, and ledgers prove what executed for final aggregation;
they are not a cache and cannot authorize skipping execution. Existing
finalized artifacts, duplicate admissions, and duplicate ledger entries fail
closed.

A source repair therefore requires a new commit and new run; GitHub does not fix
source code, and an earlier green result cannot be carried into the repaired
candidate. A failed-jobs-only rerun creates a new run attempt and cannot combine
old successes with new results into an aggregate engine pass.

Existing lock-bound dependency download caches may persist. They are not test-
result caches. Same-run build reuse is allowed only for the successful build
explicitly described above: the local browser stage may consume its bound local
build, and the Cypress job may consume its own same-job build. No compiled build
or test result transfers between runner environments.

## Candidate binding and evidence

The engine fails closed when required work fails, no active tests execute,
output is partial or truncated, expected results are missing or duplicated,
source changes after planning, isolation is unproved, or evidence does not close
the plan.

Local execution retains native receipts, logs, case outcomes, skips, timings,
and process ownership/cleanup evidence. Hosted execution retains GitHub's native
job logs and, for work that reaches engine admission, case-qualified copies of
the raw JUnit, native Node, and Cypress result files alongside sealed admissions,
evidence manifests, parsed closure summaries, success receipts, and
attempt-scoped ledgers.

The engine does not install development dependencies, provision missing tools,
apply live migrations, mutate provider accounts, repair source code, approve
code review, or substitute for required human or provider verification.

## Maintenance boundaries

Maintain meaningful tests and fixtures with behavior changes. Update the
applicable workload membership in `vroom-app.cfg`, run affected focused checks
during development, then run the complete applicable gate against the exact
final candidate before publication.

Do not weaken or delete a valid assertion to obtain a pass. When accepted
behavior genuinely supersedes an assertion, replace it with equally meaningful
current coverage and record the reason.

Vroom's repository entry point is `bin/run-local-validation.mjs`. Native Vitest
and GitHub workflow files supply the implementations and runner environments
referenced by `vroom-app.cfg`; they are not independent workload authorities.
