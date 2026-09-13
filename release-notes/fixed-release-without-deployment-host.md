---
category: fixed
audience: operators
area: release-pipeline
action: none
breaking: false
---
Main-branch releases now continue through image and artifact validation when the live deployment host is unavailable, while the live deployment is safely skipped until its storage is healthy.
