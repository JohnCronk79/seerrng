# External runtime integration configuration

Outbound integrations can be configured through the `SEERR_EXTERNAL_CONFIG`
environment variable. Its value is a JSON object containing the integration
sections exported from `settings.json`.

When `SEERR_EXTERNAL_CONFIG` is not set, the application falls back to reading
integration configuration directly from `settings.json`. This maintains
backward compatibility with existing installations.

For deployments using a secret manager, inject the exported JSON directly into
the environment:

```sh
SEERR_EXTERNAL_CONFIG="$(node scripts/export-external-config.mjs /path/to/settings.json)" pnpm start
```

For production with a secret manager, configure the variable through the
deployment's secret injection mechanism rather than shell history.

The value must be supplied directly as an environment variable. The
application intentionally does not support a file-valued fallback such as
`SEERR_EXTERNAL_CONFIG_FILE`.
