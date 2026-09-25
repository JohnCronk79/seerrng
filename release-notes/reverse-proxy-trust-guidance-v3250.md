---
category: changed
audience: operators
area: network
action: Enable reverse-proxy trust when SeerrNG is reachable only through one trusted reverse proxy that sets X-Forwarded-For, then restart SeerrNG.
breaking: false
---
Network settings now explain when reverse-proxy trust is needed and why it must remain off when clients can connect directly. This helps operators avoid incorrect client-IP handling and rate-limit errors behind a reverse proxy.
