---
category: security
audience: operators
area: operations
action: none
breaking: false
---
Built-in HTTPS health checks now validate the configured local CA or certificate
chain instead of disabling certificate verification, so broken trust
configuration is reported as unhealthy rather than silently accepted.
