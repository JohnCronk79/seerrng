---
category: added
audience: operators
area: monitoring
action: Set `METRICS_ENABLED=true` and a long random `METRICS_AUTH_TOKEN` to expose `/metrics`.
breaking: false
---
Seerr now exposes request, active-request, cache-hit, and external-API counters in Prometheus format when metrics are enabled; an importable Grafana dashboard is included and the endpoint requires a bearer token.
