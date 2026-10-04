---
category: fixed
audience: users, operators
area: authentication
action: none
breaking: false
---
CSRF protection is disabled by default again, matching the documented default and fixing "invalid csrf token" errors during initial Jellyfin/Emby sign-in. Existing installs are migrated back to this default once on upgrade; if you had intentionally turned CSRF protection on, re-enable it in Settings > Network afterward.
