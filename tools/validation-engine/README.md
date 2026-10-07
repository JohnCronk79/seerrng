# SeerrNG validation engine

This is the authoritative operating guide for the validation engine bound into
this repository. Use the existing `validate:development` entry point. Do not
create another launcher, runner, frozen inventory, or copied test bundle.

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
commands, alter planned dependencies, reinterpret results, or decide that an
incomplete run passed.

There is no public worker-count option. Internal host overrides exist only for
reviewed engine integration and tests; ordinary baselines must use automatic
capacity selection.

The `--github-*` modes shown by `--help` are internal GitHub Actions bindings,
not manual replacements for the local commands.

## Distributed developer-fleet mode

Mode 3 uses this same `validate:development` entry point for discovery,
controller, and worker modes; there is no second runner. Read-only distributed
discovery derives the complete platform-specific native task catalog from the
tests-only plan. The catalog contains one task for each selected Vitest,
TypeScript `node:test`, and JavaScript `node:test` file, plus one task for the
complete registered tooling lane.

This is a complete **native tests-only** catalog, not the complete pre-PR gate.
It does not include repository and supplemental checks, CodeQL, production
builds, Cypress, hosted-job checks, or pull-request metadata. A successful Mode
3 schedule therefore cannot be reported as a successful full
`pnpm validate:development` run.

Every participating worker must run the same immutable image built from the
same clean committed source, tracked lockfile, supported Node and pnpm versions,
and installed lockfile-bound dependencies. Every discovered task file must be
an ordinary blob tracked by `HEAD`, and its working bytes must match that blob;
ignored or hidden local test content fails discovery. The image build described
below imports the sealed source snapshot and installs dependencies once; the
Mode 3 controller protocol itself neither transfers source nor installs
dependencies. A task is identified by `distributedNativeTaskId()` from its
application ID, native adapter ID, and canonical repository-relative file list.
Workers accept only IDs named locally with `--allow-task`; a controller cannot
transmit a command, arguments, working directory, environment, or executable
path.

Use either discovery form below to print the sealed local catalog and its task
IDs. Discovery launches no native task. The second form also exclusively
creates a compact sealed task manifest at an unused absolute path outside the
source checkout:

```text
pnpm validate:development --distributed-discover --app seerrng=ABSOLUTE_ROOT --application seerrng
pnpm validate:development --distributed-discover --app seerrng=ABSOLUTE_ROOT --application seerrng --json
pnpm validate:development --distributed-discover --app seerrng=ABSOLUTE_ROOT --application seerrng --task-file ABSOLUTE_FILE
```

The manifest binds the application, platform, candidate, full catalog and
inventory hashes, task count, canonical unique task IDs, and its own SHA-256
seal. Schedule and worker admission independently rediscover the complete local
catalog and require every bound value to match. A schedule accepts exactly one
selection form: at least two repeated `--task` values for an explicit partial
smoke, or one `--task-file` for a complete catalog. A worker likewise accepts
exactly one local allowlist form: repeated `--allow-task` values for a partial
smoke, or one `--allow-task-file` for the complete bound catalog.

Remote workers require a configured HTTPS origin, a pinned certificate SHA-256
fingerprint, the shared fleet secret in
`SEERRNG_DISTRIBUTED_SHARED_SECRET`, and an exact controller source-address
allowlist. The secret is canonical base64 containing at least 32 random bytes;
it does not belong in the worker config, command line, logs, repository, or
native test environment. Authenticated messages tolerate at most five seconds
of clock skew, so participating machines must keep their clocks synchronized.

Use `--help` for the exact bounded command forms. Mode 3 accepts exactly one
`--app`. The worker listens on the port in its configured HTTPS address and
remains active until interrupted. The secret-free worker configuration records
each worker's enabled state, HTTPS identity, and either an explicit capacity or
automatic capacity detection.

`--distributed-controller` retains the one-worker, one-task acceptance path.
When `--worker-id` names the configured controller-local worker, it uses the
same worker handler in-process without opening an HTTPS connection; set
`controllerWorkerId` to `null` when proving the real HTTPS path.

`--distributed-schedule` uses every enabled configured worker and requires at
least two workers and two selected tasks. Before starting any native task, the
controller probes every worker and requires authenticated, idle,
candidate-matched capability and capacity evidence. It then assigns the
canonical task list deterministically across interleaved worker-capacity slots
and never exceeds each worker's admitted capacity. A verified native failure
does not suppress independent tasks. An unknown transport outcome makes that
worker unavailable; its task is not retried or reassigned because doing so could
execute it twice. The schedule passes only when every selected task passes and
writes one sealed, size-bounded aggregate JSON report outside the checkout. A
manifest-backed report records the admitted manifest seal; repeated-ID smoke
reports record `null`. Controller or fleet-admission errors also write bounded,
sealed failure evidence without copying arbitrary exception text into the log.

Catalogs are platform-specific. A complete Linux catalog must use a Linux
controller and Linux-only workers built from the same candidate and worker
image. Do not mix a native Windows worker into that schedule: platform
exclusions and the tooling task can differ even when some per-file task IDs are
the same. Windows validation remains a separate native run and cannot be
counted as part of the Linux schedule. Cross-platform aggregate reconciliation
is not implemented.

The Linux worker image is defined by
`tools/validation-engine/container/Dockerfile.worker`. Its `source.bundle` must
be generated from an exact clean depth-1 candidate snapshot plus the exact
`v3.*` release-tag refs, with each tagged commit kept as a separate shallow
boundary rather than importing repository history. Bundle provenance records
the release-tag count and digest. The build receives `SOURCE_COMMIT` and
`SOURCE_BUNDLE_SHA256`, verifies the bundle, restores only those release-tag
refs, and imports the candidate as a one-commit shallow checkout with no
remote. It installs frozen lockfile-bound dependencies without the Cypress
binary and verifies clean Git metadata. It runs the existing engine entry
point as a non-root user. Runtime
orchestration must make the container read-only, provide bounded temporary
storage, drop all capabilities, enable `no-new-privileges`, and mount TLS,
manifest, and evidence paths with only their required access. Full Linux
catalog workers must use the identical built image rather than independently
rebuilt variants.

The implemented slice covers source and task identity, sealed task-manifest
handoff, all-worker admission, deterministic capacity-aware scheduling,
authenticated local and remote execution, cancellation, native result
evidence, and aggregate reconciliation. It does not yet provide task-duration
weighting, timing-history reuse, multi-application queues, source distribution,
disconnect retry, controller-crash recovery, or cross-platform aggregation.
Those capabilities must not be inferred from a successful Mode 3 run.

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

The immutable plan contains 10 logical validation units. Their matrices expand
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
