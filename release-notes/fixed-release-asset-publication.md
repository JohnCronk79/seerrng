---
category: fixed
audience: operators
area: release-pipeline
action: none
breaking: false
---
Release asset publication now has permission to download the platform archives produced earlier in the same workflow, so a successful build matrix can complete the GitHub release instead of failing at the upload gate.
