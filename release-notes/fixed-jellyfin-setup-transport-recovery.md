---
category: fixed
audience: users, operators
area: authentication
action: restart SeerrNG after changing browser transport settings
breaking: false
---
First-run setup now waits for an active HTTPS or explicitly enabled HTTP session mode before media-server sign-in, and recovers clearly when a previous attempt saved Jellyfin details without establishing a browser session.
