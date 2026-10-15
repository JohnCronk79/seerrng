# Vroom developer data

This folder contains local timing history produced when Vroom runs Seerr. The
history belongs to the developer or contributor who owns this environment. Git
tracks this README but ignores the runtime folders and timing files beside it.

## Layout

```text
dev-user-data/
|-- README.md
`-- timing-<target-id>/
    `-- <workload>/
        |-- timing-<date-and-time>.log
        `-- <profile>/
            `-- timing-<date-and-time>.log
```

Every folder immediately below `dev-user-data` must describe its contents on
its own. Timing history therefore uses `timing-<target-id>`. Other future data,
such as federation-level diagnostics, must use a different descriptive prefix
and must not be mixed into a timing folder.

`<target-id>` names the actual execution pool configured in `vroom.cfg`. It is
not the command-line argument used to start Vroom. Current timing folders are:

1. `timing-local-node` - the current computer acting as one node.
2. `timing-github-hosted` - the configured GitHub-hosted VM pool.
3. `timing-john-home` - John's local cluster site.

Future timing targets can use stable folders such as `timing-keith-home`,
`timing-keith-office`, and `timing-family-federation`. A federation owns one
combined timing record containing the per-site, controller, and node samples. A
site run by itself uses the site target instead. A target keeps the same history
whether GitHub or a local command launched it.

`<workload>` is an application-owned section from `vroom-app.cfg`, such as
`dev`, `compile`, `pre-pr`, `github`, or `github-full-test-suite`. A workload
with named profiles adds one final folder per profile; Seerr's `dev` workload
currently uses `src` and `server`.

Vroom keeps only the newest five comparable timing logs in each final workload
or profile folder. The timing record stores launch mode and per-node details for
diagnostics. Large native reports remain with their provider or application.
Node receipts are temporary transport files: Vroom reads them from Linux
temporary storage during reconciliation and then removes them.
