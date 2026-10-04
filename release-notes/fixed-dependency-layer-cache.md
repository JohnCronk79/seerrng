---
category: fixed
audience: operators
area: release-pipeline
action: none
breaking: false
---
Container builds now cache dependency installation separately from application source changes, reducing repeated native-module compilation for routine image builds.
