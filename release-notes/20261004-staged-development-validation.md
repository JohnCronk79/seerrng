---
category: changed
audience: operators
area: development-validation
action: none
breaking: false
---

Development validation now coordinates repository checks, security scans, production builds, and browser tests through the existing engine. Pull-request and main-branch CI preserve native jobs while the current-run plan selects applicable checks and verifies their results without reusing prior runs.
