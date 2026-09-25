---
category: fixed
audience: operators
area: release-pipeline
action: none
breaking: false
---
Release retries now pass artifact-download permission from the top-level release workflow into the reusable asset workflow, allowing an existing draft release to recover after its platform archives finish building.
