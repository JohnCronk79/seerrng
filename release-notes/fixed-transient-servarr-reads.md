---
category: fixed
audience: users, operators
area: services
action: none
breaking: false
---
SeerrNG now retries a transient Sonarr, Radarr, or other provider read failure before showing a connection error, reducing false “unable to connect” warnings while preserving persistent failures.
