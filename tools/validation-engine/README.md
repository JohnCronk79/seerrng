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

Mode 3 extends the same engine and native test ownership into a Linux
controller-and-node fleet. It does not define a second test suite. The
production staged bridge keeps the four-stage gate and replaces only the native
repository-test execution inside Stage 1:

1. Stage 1 repository and supplemental checks remain controller-local and cross
   their normal isolation boundary one check at a time.
2. The complete platform-specific native catalog is distributed across the
   controller and every admitted node. It contains one task for each selected
   Vitest, TypeScript `node:test`, and JavaScript `node:test` file, plus one task
   for the complete registered tooling lane.
3. CodeQL, the guarded production build, and Cypress/browser validation remain
   controller-local and retain their existing stage order and evidence rules.

The bridge reconciles the distributed catalog, schedule, assignment, result,
and native case totals back into the ordinary Stage 1 receipt. A native-only
Mode 3 result is not a full-gate result. Only the staged bridge completing all
four stages may satisfy the local pre-PR gate.

### Linux setup and configuration

`tools/validation-engine/setup/install-distributed-test-engine.sh` is the
menu-driven Linux setup program. It installs or configures a controller or
node, manages supported applications, and plans application dependencies. An
installation offers to continue directly into configuration. Controller
automatic startup uses a managed systemd service; node automatic startup stays
disabled until explicit application-root provisioning is complete, so the MVP
node is started manually with its bound application root.

Mode 3 configuration is human-readable text rather than JSON:

- The controller file is
  `test-suite-multi-computer-<GitHub username>.cfg`. Its global section records
  the controller identity, address, detected CPU and available threads, thread
  rule, and minimum thread count. It also owns supported applications,
  application dependency requirements, enrolled node identities and thread
  policies, and each node's reported dependency availability.
- Each node has one `test-suite-multi-computer-node-##.cfg`. It records the
  controller address, that node's descriptive name, address, detected CPU and
  available threads, selected applications, and verified dependency versions.
- The shared cluster key is the final setting in each enrolled configuration.
  First contact intentionally trusts the private LAN: the operator supplies the
  controller address and selected node number, and the controller returns the
  same cluster key only after accepting the enrollment. Reusing an occupied
  node number requires an explicit overwrite choice.
- One node means one logical computer at one IP address. A physical computer
  running multiple virtual machines exposes each VM as a separate node with
  its own address. The controller rejects assigning one address to two node
  numbers.
- Node execution counts are controller-owned. A thread rule may be a number or
  an `n` expression such as `n-2` or `2n`; the minimum thread count is applied
  after evaluating that rule against the node's detected available threads.

After configuration, an atomic active-config marker selects the exact file the
controller or node service must load. Services do not guess between nearby
configuration files. Configuration writes are private, locked, atomic, and
read back before acceptance.

### Application dependencies and node admission

Each supported repository owns one
`<appname>-test-suite-dependancies.cfg` profile containing a single
`[Dependencies]` section with dependency names and exact required versions.
The controller records the full product/version application ID, a descriptive
instance name, and the absolute path to that repository-owned profile. Nodes
receive selected application metadata and report the dependency versions they
actually provide; they do not keep copied profile files.

The controller reads the current application profile for every run, probes all
configured nodes, and distinguishes available nodes from usable nodes. The
prepared controller environment is eligible locally. A remote node is usable
only when its authenticated identity, candidate catalog, assigned thread
policy, and reported dependency versions match. If an available remote node is
missing or has an outdated dependency, the engine lists the exact difference
and asks whether to continue with only usable nodes or stop for repair. A
non-interactive run stops instead of assuming consent.

The setup menu can resolve and display dependency plans. Fixed installers for
the profile's approved dependencies are not yet bound, so it must not claim to
have installed or repaired those tools until the adapters are implemented.

### Adaptive scheduling and execution

Before launching native work, the one-shot controller rediscovers the exact
clean committed catalog locally and requires each node to prove the same
application, platform, candidate, inventory, and catalog. A node accepts only a
locally discovered task ID; the controller does not send arbitrary commands,
arguments, paths, or environments.

The adaptive scheduler combines each admitted computer's controller-owned
thread budget with test dependencies and timing estimates. Matching timing
history supplies duration-weighted work estimates; new or changed tests use a
bounded cold-start estimate. The schedule assigns work continuously across the
available thread slots, preserves declared dependencies, and records its
predicted placement. CPU model and clock speed are descriptive only: observed
task timing, not a hardware lookup, is the scheduling source of truth.

Timing profiles have validated, private, atomic file storage, and successful
complete observations can update their per-node and per-thread estimates.
The current staged binding scopes a match to its supplied repository identity.
Binding the real launch to automatically read, update, and persist useful
history across consecutive laptop-and-NAS candidates remains part of the
pending end-to-end proof; a caller must not infer that history was saved or
reused merely because the scheduler consumed a profile.

The controller executes assigned local tasks through the same native adapter
used by nodes. Remote requests use the shared cluster key, bounded request
identity, and exact candidate/catalog bindings. Every task must reconcile
exactly once against its assigned node and thread slot. Test-result reuse stays
disabled: timing history can influence placement but cannot skip work or turn
an old success into a current result.

Catalogs remain platform-specific. A complete Linux run requires a Linux
controller and Linux nodes with the same clean candidate and dependencies.
Windows validation is separate and cannot be counted as part of the Linux
schedule. The Mode 3 protocol does not clone repositories or provision source;
each node must already expose the explicitly bound application root.

### Current proof boundary

Focused configuration, enrollment, dependency-admission, adaptive-scheduling,
controller/node transport, task-execution, staged-bridge, and reconciliation
tests are implemented. The first real full four-stage run using the laptop as
controller and the NAS as a remote node has **not yet completed**. Until that
run succeeds and its stage timings and evidence are recorded, Mode 3 must not
be described as fully proven or assigned a production speedup.

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
