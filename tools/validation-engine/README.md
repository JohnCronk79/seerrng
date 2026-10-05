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
Current GitHub workflows still invoke their separate native jobs, not this staged
development gate. Their native Vitest configuration already uses the automatic
GitHub CPU policy; that alone does not establish staged-engine integration.
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

## Reuse

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
