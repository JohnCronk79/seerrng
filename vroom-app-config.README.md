# Vroom application configuration

`vroom-app.cfg` is the application-owned source of truth for every workload,
job command, test scope, dependency, and selection rule used by Vroom. Vroom's
engine does not contain Seerr-specific paths, commands, or test names.

## Workload sections

Each section is a workload that can be requested from Vroom. When no workload
is supplied, Vroom selects `[dev]`.

```ini
[dev]
[compile]
[pre-pr]
[github]
```

## Job definitions

A job starts with a unique name and its native application command:

```ini
client-tests = pnpm exec vitest run --passWithNoTests
```

Optional settings reuse the job name followed by a period:

```ini
client-tests.files = src/example-one.test.ts, src/example-two.test.ts
client-tests.when = src/**, tsconfig.json
client-tests.compare = main
client-tests.after = typecheck-client
client-tests.kind = check
client-tests.exclusive = false
```

### `.files`

The application lists the file or folder arguments that Vroom appends to the
job command. Use comma-separated relative paths. A fixed test inventory belongs
here when exact test files are required.

Vroom never replaces this list with its own application-specific tests. A
folder may be listed when the application's native runner already defines that
folder as an unambiguous test scope. For example, Seerr's current Vitest
configuration defines the test files under `src` and `server`, so those folders
can be passed without copying hundreds of filenames into this cfg.

### `.when`

The application lists the changed source paths that make a job applicable.
Entries are either an exact relative path or a folder followed by `/**`.
Vroom compares committed branch changes plus staged, unstaged, and untracked
files against these rules.

Every matching job is selected. If source and server paths both changed, their
respective jobs are both selected and scheduled.

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
