# SeerrNG validation engine

This is the authoritative operating guide for the validation engine bound into
this repository. Use the existing `validate:development` entry point. Do not
create another launcher, runner, frozen inventory, or copied test bundle.

The engine owns discovery, stage order, worker selection, candidate binding, and
result accounting. Existing native test runners, commands, action pins, runner
environments, assertions, and fixtures remain authoritative within that plan.

## Developer commands

Run from the repository root:

```text
pnpm validate:development --help
pnpm validate:development --plan
pnpm validate:development --plan --json
pnpm validate:development --tests-only
pnpm validate:development
```

- `--help` prints the exact supported modes without reading the project or
  creating files.
- `--plan` is read-only. It reports current discovery, native ownership,
  commands, exclusions, and staged coverage.
- `--tests-only` executes the local repository-test plan through its native
  runners. It does not claim CodeQL, production-build, Cypress, hosted-job, or
  pull-request metadata coverage.
- With no mode flag, the engine admits the complete local staged gate. It runs
  only when the required source, dependency, toolchain, fixture, network, and
  browser-isolation boundaries can be proved. Otherwise it stops incomplete and
  preserves preparation evidence.

A reviewed host may supply containment and proof callbacks to the bound engine
APIs. It may provide mounts, disposable fixtures, network boundaries, and
durable evidence storage. It must not rediscover tests, choose substitute
commands, reorder stages, reinterpret results, or decide that an incomplete run
passed.

There is no public worker-count option. Internal host overrides exist only for
reviewed engine integration and tests; ordinary baselines must use automatic
capacity selection.

The `--github-*` modes shown by `--help` are internal GitHub Actions bindings,
not manual replacements for the local commands.

## Test discovery and ownership

Tests remain in their repository-owned locations and native formats. Hosted
discovery assigns every supported test file exactly once to one of these lanes:

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

Local staged execution does not reuse prior successful test results. Local build
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

The engine owns this fixed ordered graph:

1. Repository units run in parallel: release notes, i18n/tooling, unit tests, and
   applicable documentation links.
2. CodeQL runs after repository units finish, with separate Actions and
   JavaScript cases.
3. Build units run in parallel after CodeQL finishes: Jellyfin plugin and smoke,
   the existing Alpine lint/production build, documentation build/security, and
   Helm validation.
4. Cypress runs after the build units finish.

These are ordering barriers. Later stages use diagnostic continuation after an
earlier failure unless the workflow is cancelled. Final reconciliation still
rejects every required failure, cancellation, missing result, or unexpected
skip.

After a job completes the native setup required to establish its dependency and
runner identity, each applicable unit or matrix case:

1. downloads the immutable plan;
2. verifies the current candidate, workflows, and test inventory;
3. admits its exact planned unit and case;
4. either executes its existing native work or accepts an exact reusable success;
5. preserves its sealed result, evidence manifest, and attempt-scoped ledger;
6. uploads those artifacts for reconciliation.

A successful execution creates the ledger's single success entry. Failed,
cancelled, or incomplete work leaves the ledger blank and cannot be reused.
If native runner setup fails before engine admission, the GitHub job fails and
the missing required receipt makes final reconciliation fail closed; the native
job log remains the failure evidence. No pre-admission failure can be reported as
an engine success.

The unit-test job preserves `pnpm test:ci` and also runs the dynamically
discovered native Node lane with exactly `N` effective workers. A successful
receipt requires the JUnit report to contain every planned Vitest file exactly
once with active tests and no failures or errors. The engine-owned Node result
must match the same admission, worker capacity, inventory, and lane. Each
planned native Node file runs in its own isolated process through an `N`-wide
engine pool and must produce a nonempty complete TAP hierarchy; the sealed
per-file reports, files, case counts, and aggregate result must all reconcile.

The existing Alpine production-build job remains intact. Cypress separately
performs one Ubuntu `pnpm cypress:build` inside the Cypress job, then the pinned
Cypress action reuses that same-job build instead of building again. No compiled
build is transferred between different runner environments.

Final reconciliation downloads the immutable plan and the complete current-
attempt admission, receipt, and ledger artifacts. It requires exactly one
successful sealed artifact set for every applicable unit case. It verifies the
planned artifact set and the candidate, workflow, command, test-inventory,
admission, result, and ledger bindings. GitHub's native job logs remain the
evidence for action-managed tool setup that is not itself safely reusable.

Path- or event-inapplicable jobs must be skipped exactly as planned. Pull-request
title, template, and merge-conflict checks remain external GitHub metadata and
are not represented as engine-executed native work. Standalone scheduled or
manual reusable-workflow launches are native runs, not aggregate hosted-engine
passes.

## Result reuse and caches

Hosted result reuse is deliberately narrow:

- every run attempt starts with an empty result ledger;
- only the unit-test job is currently eligible, because it has both a bound
  installed dependency lock and semantic native-result closure;
- even that job may reuse only an exact duplicate of completed successful work
  within the same run attempt;
- the candidate, plan, unit, case, command, dependencies, tools, runner, setup,
  workflow, admission, receipt, and ledger must all match;
- CodeQL, builds, documentation, Helm, links, release, i18n/tooling, and Cypress
  results are default-deny until their complete execution-defining setup can be
  proved;
- failed, cancelled, partial, missing, duplicated, or tampered work is never
  reusable;
- successes never cross run attempts, commits, candidates, or pull-request
  updates.

The normal hosted graph currently schedules every unit/case once and does not
preload another job's receipt directory. Ordinary GitHub runs therefore execute
each applicable unit once and receive no baseline speedup from result reuse. The
eligible unit-test reuse path becomes active only if a deliberate same-attempt
duplicate consumer is wired later with the matching sealed artifacts.

A source repair therefore requires a new commit and new run; GitHub does not fix
source code, and an earlier green result cannot be carried into the repaired
candidate. A failed-jobs-only rerun creates a new run attempt and cannot combine
old successes with new results into an aggregate engine pass.

Existing lock-bound dependency download caches may persist. They are not test-
result caches. Same-job build reuse is allowed only where explicitly described
above.

## Candidate binding and evidence

The engine fails closed when required work fails, no active tests execute,
output is partial or truncated, expected results are missing or duplicated,
source changes after planning, isolation is unproved, or evidence does not close
the plan.

Local execution retains native receipts, logs, case outcomes, skips, timings,
and process ownership/cleanup evidence. Hosted execution retains GitHub's native
job logs and, for work that reaches engine admission, sealed admissions,
evidence manifests, parsed unit-test closure summaries, success receipts, and
attempt-scoped ledgers.

The engine does not install development dependencies, provision missing tools,
apply live migrations, mutate provider accounts, repair source code, approve
code review, or substitute for required human or provider verification.

## Maintenance boundaries

Maintain meaningful tests and fixtures with behavior changes. Run affected
focused checks during development, then run the complete applicable gate against
the exact final candidate before publication.

Do not weaken or delete a valid assertion to obtain a pass. When accepted
behavior genuinely supersedes an assertion, replace it with equally meaningful
current coverage and record the reason.

The bound implementation lives under `tools/validation-engine/runtime/`. Its
single repository entry point is `bin/run-local-validation.mjs`; native Vitest
and GitHub integration remain in their existing configuration and workflow
files.
