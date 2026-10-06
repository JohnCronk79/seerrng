---
category: fixed
audience: operators
area: validation-engine
action: none
breaking: false
---

Distributed validation workers now run under a pinned, verified init process that forwards shutdown signals and reaps orphaned test processes consistently across Docker hosts.
