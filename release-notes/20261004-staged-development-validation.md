---
category: changed
audience: operators
area: development-validation
action: none
breaking: false
---

Development validation now stages repository checks, security scans, production builds, and browser tests in the existing engine, reports native failures, and automatically selects worker limits from available CPUs and the local or GitHub Actions context. Pull-request and main-branch CI preserve their native jobs while a current-run engine plan selects applicable checks and verifies their exact results without reusing prior runs.
