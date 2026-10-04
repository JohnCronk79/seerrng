---
category: fixed
audience: users, operators
area: reliability
action: none
breaking: false
---
SeerrNG no longer crash-loops on startup when it cannot `chmod` its config, log, database, or image-cache directories (common when a container runs as a non-default user against a bind mount or network volume it doesn't own) — it now logs a warning and continues with the existing permissions.
