# CodeQL triage — 2026-10-07

The ReadMeABook and Jellystat outbound-request alerts were reviewed against the
routes that supply their settings and request data.

- `js/request-forgery` on ReadMeABook points to the administrator-configured
  service origin. The settings and connection-test routes require admin
  permission; ordinary users cannot choose the destination. Private hosts are
  supported for self-hosted deployments. Request paths are fixed or encoded,
  and redirects are disabled.
- `js/file-access-to-http` on ReadMeABook and Jellystat points to values read
  from integration settings and request records. The APIs intentionally send
  their configured credentials and validated request metadata to the matching
  configured service. Neither client reads arbitrary files, and both disable
  redirects.

These findings are false positives for the product's configured integration
flow. The alert dismissals retain this rationale so the same findings can be
recognized if the clients or settings routes change later.
