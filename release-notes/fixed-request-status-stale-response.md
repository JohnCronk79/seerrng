---
category: fixed
audience: users
area: requests
action: none
breaking: false
---
Movie and TV requests now show their real status (e.g. Processing) right after submission instead of appearing stuck at Pending until a download starts — the request API was returning a stale status snapshot taken before auto-approval updated it.
