# Saved SeerrNG validation engine

The archive below preserves the reviewed engine and historical evidence.
Its CPU-capacity module is now also bound into the application's native Vitest
configuration under `runtime/`. Normal `test`, `test:vitest`, and `test:ci`
commands stay unchanged; no separate engine or user launch command is added.
The existing development gate preserves its dynamically discovered ownership
when generating a native Vitest subset configuration.

Independent files use the selected capacity in isolated forks with a fresh
temporary configuration per file and the original setup/network/database guards.
The five existing quiet owners run serially after the independent batch, not
alongside it. Native tooling regression tests are registered in Seerr's existing
tooling-test command, which the GitHub CI security check already invokes.

Native stage adapters and the existing reviewed coordinator are now bound under
`runtime/`: repository checks/tests, CodeQL, production build, then Cypress.
Each stage reserves the selected worker budget exclusively; these reservations
are not a measurement of operating-system threads. CodeQL preserves both Actions
and JavaScript scans, default plus security-and-quality queries, the workflow's
model pack, and actual findings. Cypress preserves the native spec inventory,
case attempts and conditional skips, reusing only this run's successful build.
It remains one native browser process until isolated sharding is demonstrated.

Supplemental descriptors include council boundary checks, documentation security
and builds, the .NET 9 Jellyfin plugin and disposable smoke, release contracts,
conditional charts, and advisory links. Missing prerequisites remain blocked;
trusted-base GitHub metadata checks remain separately pending. No local report
may silently represent those as executed passes. The existing process runner
provides stream hashes, persistent owned logs and managed server cleanup rather
than introducing another runner. Its historical string-returning API remains.

The existing `validate:development` entry now selects these stages automatically;
`--help` and `--plan` remain read-only, and `--tests-only` retains the original
native test-only behavior. Preparation creates owned source copies and binds
native receipts, full output logs, actual case ledgers, tool versions, dependency
locks and read-only references. Completed and failed execution evidence is kept.

The full gate requires a verified repository network boundary, private Docker
fixtures, browser provider isolation and complete Git history/tags. Reviewed
internal host contexts can supply those proofs through the existing engine APIs;
the public entry does not yet acquire a complete context on an ordinary checkout
and reports incomplete when the required proofs are absent. Development provisioning is not part of
this engine, and no separate end-user runner or command is introduced.
Pull-request and main-branch CI now place the existing native jobs behind a
current-run hosted engine plan and reconcile their exact results afterward. The
five jobs already in `ci.yml` and five existing reusable workflows remain native
and run in parallel after planning; the engine does not replace their commands,
actions, runner images or environment split. Reconciliation fails closed on a
missing, extra, stale, failed, cancelled or unexpectedly skipped result, and it
does not reuse a prior run. Dedicated scheduled and manual workflow launches
remain native standalone runs rather than being reported as a full hosted-engine
pass. Trusted pull-request title, template and mergeability checks also remain
separate external metadata.
Because each hosted plan is bound to one run attempt and result reuse is disabled,
retry the complete workflow rather than using GitHub's failed-jobs-only rerun. A
failed-jobs-only attempt deliberately cannot combine earlier successful jobs with
new results to produce an aggregate pass.
An expanded continuous baseline must be identified by its own frozen candidate,
complete native receipts and measured lifecycle, not the archived result below.
Focused adapter tests are not evidence of a successful full scan, build, browser
suite, or performance improvement. The archive's immutable-consumer/source-repair guarantees are
unchanged. A native Vitest run does not by itself establish a full frozen source
manifest, lifecycle proof, complete case ledger, or retained-green cache closure.

`validation-engine-v1.1.0.tar.gz` contains the hash-verified reusable
controller, reviewed repair/retest components and AI setup instructions, plus
the exact frozen recipes and inventory from the latest successful V7 run.
The original RC1 status remains historical; `LATEST-RESULT.txt` records the
later V7 result separately. The inventory identifies every saved file.

The archived reference run tested SeerrNG 3.48.1 at commit
`897adeefa77371abed217e7d454d29cf0985b58b`, not the currently selected candidate.
It passed 3,983 cases across 553 test files, with zero failures and four
existing PostgreSQL conditional skips, in 5m36.205s including host lifecycle.
No application repair was needed in that run. Browser/Cypress, CodeQL,
compilation and release/deployment checks are not acceptance implied by it.

Worker capacity is selected inside the engine from effective logical CPUs after
visible-CPU and cgroup limits. The universal default is `max(1, N - 1)` workers.
GitHub Actions uses `N` workers regardless of actor identity. Locally, when the
public GitHub login `JohnCronk79` is detected through ordinary Git identity,
the same engine automatically uses `2N`. This follows the
operator across development machines without using a machine name, OS account,
Docker volume, credential lookup or separate runner. An explicit bounded worker
override remains available to maintainers. The historical V7 result still records
its original 24-slot configuration; it is not evidence for this updated policy.

## Runtime safeguards and developer judgment

The engine orchestrates execution; the repository's independently maintained
tests define correctness. Developers update tests and fixtures alongside bug
fixes, features, behavior and visual changes without adopting an engine-specific
test format. Shared visual checks belong in that coverage: accepted semantic
class ownership and the no-new-Tailwind rules apply to affected consumers,
regardless of which developer changed them. During development, use affected
checks rather than repeated whole-suite or all-platform builds. Before a commit
or PR, run the complete applicable PR-check coverage and required compilation
against the exact candidate. Discovery must follow its current tests, not a
frozen reference inventory; report genuinely unavailable hosted/platform checks
as unverified, never passing.

These safeguards belong to the existing engine, not a per-change agent checklist:

- `bin/local-validation.mjs` discovers the current repository's native test files
  and retains selected ownership. Native result readers check actual case counts,
  identities, duplicates and output closure; discovery is not proof that an
  intended behavioral assertion was written or preserved.
- `runtime/native-stage-context.mjs` pins actual candidate bytes, modes and
  source/dependency/tool identities and checks freshness at execution boundaries.
  Fixture configuration and process ownership remain run-local, with existing
  network/provider guards. Missing context prerequisites block execution.
- `runtime/cpu-capacity.mjs`, `controller.mjs` and `staged-validation.mjs` enforce
  detected capacity, exclusive stage budgets, ordered barriers and declared
  dependencies. `vitest-binding.mjs` handles independent files and quiet owners.
  This is not a claim of archived per-file impact/cost scheduling in every runner.
- Native adapters retain original commands/assertions, case outcomes, skips,
  timings and process/log receipts. Failed required checks and missing coverage
  cannot become an overall pass; GitHub-native metadata remains separately pending.
- Browser execution requires this run's successful build for the same candidate.
  Ordered independent stages may still collect evidence after a prior failure;
  that does not turn the candidate into a passing result.

The bound staged engine explicitly sets `resultReuse: false`. It does not accept
previous green test results, compute automatic transitive repair selections or
edit source. Archived repair/retest modules are reference implementations, not
features imported by the normal staged entry. Compiled-build reuse currently
validates successful receipts, candidate/root identity and required output
existence, not a full compiled-artifact byte/mode seal. Do not claim guarantees
the bound implementation does not enforce.

Developer judgment remains limited to maintaining meaningful behavior tests with
the implementation, deciding whether a genuinely superseded assertion needs an
equally meaningful replacement, and diagnosing/repairing real failures under the
applicable authorization. Do not weaken tests to obtain a pass. Verify a repair
with affected checks; the engine reports the observed outcomes, not code-review
approval or unperformed human/provider review.

## Archived reference reuse

1. Extract into a separate development workspace, outside automatic test globs.
2. Read `engine/AI-INSTRUCTIONS.txt`, the target repo's AGENTS and Fix-it rules.
3. Choose the actual source to test; preserve its dirty working bytes. Do not
   replace it with the 3.48.1 reference or reuse reference pass counts/pins.
4. Regenerate and review the inventory, case ledger, source/dependency/runtime
   hashes and invocation packets for that chosen source. Old Windows paths,
   Docker volumes and receipts are reference evidence, not live instructions.
5. Run with disposable config/database fixtures and provider/network guards.
   Compilation is separate. The engine queues failures; an authorized coding
   agent supplies reviewed repairs, followed by failed and affected retests.

All tests already present in the preview remain in their original locations.
The saved recipe archive is deliberately not unpacked into those locations:
that would create duplicate test discovery or overwrite a different revision.
Only reviewed runtime modules are bound into the normal native test setup.
The archived reference recipes remain outside automatic test discovery.
