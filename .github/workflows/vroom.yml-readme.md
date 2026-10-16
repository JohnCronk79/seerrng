# Vroom GitHub pull-request dispatcher

`vroom.yml` is Vroom's application-integration workflow for GitHub pull
requests. It gives an application one central place to choose its unchanged
default test workflow or Vroom. It does not replace the application's test
commands, deployment workflows, or release process.

The authoritative template and this readme live in the Vroom application
folder. The installer will place configured copies together in the target
application's `.github/workflows` folder, where GitHub can discover the YAML.

## What the installer changes

1. Ask which existing application workflow owns the normal pull-request tests.
2. Install a configured `.github/workflows/vroom.yml` and this readme.
3. Comment out the direct `pull_request` trigger in the selected workflow and
   preserve it in place as the uninstall path.
4. Add `workflow_call` to the selected original workflow.
5. Install or preserve the application's `vroom-config` files.
6. Validate both the Vroom path and the original-workflow fallback without
   starting both engines for the same pull request.

The installer replaces the four `__VROOM_*__` template values with the
registered application id, application-owned workload, dependency-setup
command, and selected default-workflow path. A user must not copy selection or
scheduling logic into the application's existing jobs.

## Required original-workflow change

For an application whose existing workflow starts like this:

```yaml
on:
  pull_request:
    branches:
      - '*'
  push:
    branches:
      - main
  workflow_dispatch:
```

the installer changes only the pull-request entry:

```yaml
on:
  # pull_request:
  #   branches:
  #     - '*'
  workflow_call:
  push:
    branches:
      - main
  workflow_dispatch:
```

All existing jobs stay unchanged. Unrelated push, manual, release, publishing,
deployment, security, and maintenance triggers also stay unchanged.

## Uninstalling the dispatcher

To return to the application's original behavior, uncomment its preserved
`pull_request` block, remove `workflow_call` if nothing else uses it, and remove
the installed `vroom.yml`. No application jobs need to be reconstructed.

## Engine selection

For a pull request, `vroom.yml` checks whether the installed Vroom engine,
configuration, and version files are present.

1. An explicit default-engine choice calls the application's original
   workflow.
2. An explicit Vroom choice uses Vroom when it is installed.
3. A blank choice uses Vroom when it is installed.
4. If Vroom is unavailable, the application workflow is used regardless of a
   blank or Vroom choice.

An application may add this optional section to its pull-request template:

```markdown
## Test Engine

Select at most one option. Leave both blank to use Vroom when it is installed.

- [ ] Default application test engine
- [ ] Vroom test engine
```

The selection job recognizes those exact checked labels. If both are checked,
the explicit default-engine choice wins safely.

## Ownership boundary

The application continues to own its workloads and commands in
`vroom-config/vroom-app.cfg`. Vroom owns planning, scheduling, node assignment,
execution coordination, result transfer, timing interpretation, and final
reconciliation. The YAML supplies GitHub's checkout, VM matrix, and artifact
mechanisms but does not become another scheduler or test inventory.

This workflow affects GitHub pull-request execution only. Local Mode 1 still
uses `vroom <application-id> <workload> --local`. A future local cluster still
uses the same configuration and Scheduler through the cluster Controller; it
does not use this GitHub workflow.

## Deferred GitHub expansion

The initial implementation intentionally handles only `pull_request`. The file
is structured so a later approved design can add:

1. Validation-only development-branch `push` events.
2. Compatible main-branch test or build work while leaving publishing and
   deployment application-owned.
3. Manual `workflow_dispatch` engine and workload choices.
4. Scheduled test runs.

Provider-native security, publishing, deployment, and maintenance workflows
remain independent unless a later design gives Vroom a narrow,
application-agnostic role in their test or build stages.

## Completion proof

Do not consider an installation complete until a pull request proves both
paths: the automatic Vroom default must not also start the application default
tests, and the explicit-default or unavailable-Vroom fallback must start the
unchanged application workflow without starting Vroom.

