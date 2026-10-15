# Vroom configuration for Seerr

The `vroom-config` folder keeps Seerr's Vroom integration files separate from
the main Seerr application files. Vroom itself remains a separate application;
this folder contains only Seerr's Vroom configuration and Seerr-specific Vroom
run data.

`vroom-config/vroom-app.cfg` is the application-owned source of truth for every
workload, job command, test scope, dependency, and selection rule used by
Vroom. Vroom's engine does not contain Seerr-specific paths, commands, or test
names.

## Folder layout

```text
vroom-config/
|-- README.md
|-- vroom-app.cfg
`-- dev-user-data/
    |-- README.md
    `-- timing-<target-id>/
        `-- <workload>/
            |-- timing-<date-and-time>.log
            `-- <profile>/
                `-- timing-<date-and-time>.log
```

`README.md` and `vroom-app.cfg` are shared application files and can be tracked
with the Seerr source. `dev-user-data/README.md` is also tracked, while the
developer-specific folders beneath it are ignored by Git.

Every runtime folder directly beneath `dev-user-data` has a self-describing
purpose prefix. Timing folders use `timing-<target-id>`, where `<target-id>` is
the stable execution target from `vroom.cfg`, not the command-line mode that
happened to launch Vroom. Current folders are `timing-local-node`,
`timing-github-hosted`, and `timing-john-home`. Future examples include
`timing-keith-home`, `timing-keith-office`, and
`timing-family-federation`. Reusing the same physical target ID allows a locally
launched run and a GitHub-launched run to share valid comparable history for
that target. Other future developer-data categories, such as federation-level
diagnostics, must use their own equally clear purpose prefix instead of being
mixed into a timing folder.

The second folder is the application-owned workload from `vroom-app.cfg`, such
as `dev`, `compile`, or `pre-pr`. A workload with profiles, such as Seerr's
`[dev]` workload, has one additional folder per profile. Vroom reads this
history when it plans optimized execution order and keeps only the newest five
comparable logs in each final folder. The launch mode is recorded inside each
timing record for diagnostics; it does not divide the history into another
folder. These records remain local and must not be committed or included in a
pull request.

Node receipts are temporary transport files. Vroom creates them in the Linux
temporary directory, reconciles them into the final result and timing record,
and leaves no persistent receipt folder in `dev-user-data`.

## Workload sections

Each section is a workload that can be requested from Vroom. When no workload
is supplied, Vroom selects `[dev]`.

```ini
[dev]
[compile]
[pre-pr]
[github]
[github-full-test-suite]
```

The application defines what each workload means. For Seerr, `dev` performs
fast affected checks, `compile` refreshes compiled production-preview output,
and `pre-pr` is the authoritative local pull-request validation workload.
During the Mode 2 proof, `github` contains the small runnable GitHub VM sample,
while `github-full-test-suite` durably preserves the complete hosted test
inventory for later migration.
Release-only packaging and publishing are separate from ordinary pull-request
validation.

## Job definitions

A job starts with a unique name and its native application command:

```ini
client-tests = pnpm exec vitest run --passWithNoTests --maxWorkers={threads}
```

`{threads}` is Vroom's application-agnostic capacity placeholder. ExecutionNode
replaces it with the capacity assigned by Scheduler and also supplies the same
number as `VROOM_ALLOCATED_THREADS`. Commands without the placeholder use one
scheduled thread slot unless they are marked exclusive.

Optional settings reuse the job name followed by a period:

```ini
client-tests.files = src/example-one.test.ts, src/example-two.test.ts
# Or let the application's own tool print one test path per line:
# client-tests.files-command = pnpm exec vitest list --filesOnly --staticParse
client-tests.when = src/**, tsconfig.json
client-tests.compare = main
client-tests.after = typecheck-client
client-tests.kind = check
client-tests.exclusive = false
client-tests.env = NODE_ENV=test
```

### `.env`

The application can provide fixed non-secret environment values for one job as
comma-separated `NAME=value` entries. Vroom applies them only to that job and
keeps its own `VROOM_` execution variables protected. Do not store credentials
or other secrets in `vroom-app.cfg`.

Seerr uses this setting to ensure production compilation runs with
`NODE_ENV=production` even when Vroom itself is launched from a development
preview container.

The same setting can neutralize preview-only safeguards for one validation
job. Seerr's native pre-PR tests set `E2E_TESTS=false` and
`SEERR_EXTERNAL_READ_ONLY=false`, giving that child process GitHub-equivalent
behavior without changing or restarting the development preview.

### `.files`

The application lists the file or folder arguments that Vroom appends to the
job command. Use comma-separated relative paths. A fixed test inventory belongs
here when exact test files are required.

Vroom never replaces this list with its own application-specific tests. A
folder may be listed when the application's native runner already defines that
folder as an unambiguous test scope. For example, Seerr's current Vitest
configuration defines the test files under `src` and `server`, so those folders
can be passed without copying hundreds of filenames into this cfg.

### `.files-command`

An application can provide a command that prints one test-file path per line
when its native test inventory is large or changes frequently. Vroom runs that
application-owned discovery command from the application root, accepts relative
paths or absolute paths contained by that root, validates the result with the
same rules as `.files`, and uses the resolved paths for ordinary sharding. Local
execution resolves the list directly. For GitHub execution, only the planning
phase runs discovery; execution nodes consume the exact resolved inventory from
the immutable plan.

Use either `.files` or `.files-command` for a job, never both. The discovery
command identifies work only; it does not run the tests.

### Provider-native jobs

A GitHub action that must retain its native action steps uses a `workflow`
declaration instead of a shell command. The application also lists the exact
GitHub job names that the completed run must return:

```ini
codeql = workflow .github/workflows/codeql.yml analyze
codeql.provider-results = CodeQL / Analyze (actions), CodeQL / Analyze (javascript)
```

The workflow path, reusable-workflow job id, and result names all remain
application-owned. Scheduler records each expected result as a provider unit
instead of assigning it to a Vroom node. During final reconciliation,
ResultTransfer reads those job conclusions from the current GitHub run and
TimingResults requires every planned provider unit before accepting the run.
Provider-native jobs cannot declare `.files`, `.files-command`, or `.env`.

### `.when`

The application lists the changed source paths that make a job applicable.
Entries are either an exact relative path or a folder followed by `/**`.
Vroom compares committed branch changes plus staged, unstaged, and untracked
files against these rules.

Every matching job is selected. If source and server paths both changed, their
respective jobs are both selected and scheduled.

### Named profiles

A workload with automatic job selection declares each independently activated
job group and its durable name in the application configuration:

```ini
profiles = src, server
profile.src.jobs = client-tests, typecheck-client
profile.server.jobs = server-tests, typecheck-server
```

Vroom activates every profile whose changed-file rules select its jobs. Source
changes activate `src`, server changes activate `server`, and changes to both
areas activate both profiles automatically. An explicit `both` profile is not
needed.

Each profile keeps its own five-file timing history. When multiple profiles run
together, Vroom writes the same complete run record into every active profile
folder, then reads only that profile's owned jobs from that copy. This preserves
the combined-run context without counting another profile's jobs twice. An
application can add names such as `interface` or `inventory-module` without
changing Vroom. Vroom rejects partial profiles and selected jobs that do not
belong to a declared profile.

### `.compare`

This optional Git ref is the baseline for `.when`. It defaults to `main` and is
valid only when `.when` is present.

Seerr's fast `[dev]` jobs explicitly use `HEAD`, so they select only staged,
unstaged, and untracked work since the current branch's latest commit. The
complete `[compile]` and `[pre-pr]` workloads do not use this development
shortcut.

### `.after`, `.kind`, and `.exclusive`

`.after` is a comma-separated list of jobs that must finish successfully first.
`.kind` can be `check`, `prepare`, `build`, or `post-build`. `.exclusive = true`
reserves the target's full Vroom capacity for that job.

## Adding an application-specific group

An application can add any clearly named group without changing Vroom. This
example runs one fixed interface test when an interface file changes:

```ini
interface-tests = npm run test:interface
interface-tests.files = interface/tests/navigation.test.ts
interface-tests.when = interface/**
```

The command, files, and trigger paths all belong to the application cfg. Vroom
only reads the declarations, selects applicable jobs, allocates resources, and
reports their results.
