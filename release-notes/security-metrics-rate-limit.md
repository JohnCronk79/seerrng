---
category: security
audience: operators
area: monitoring
action: none
breaking: false
---
The authenticated Prometheus metrics endpoint now limits requests per client, reducing the risk that repeated scrapes or unauthorized traffic can consume SeerrNG resources.
