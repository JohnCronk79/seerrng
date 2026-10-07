---
category: added
audience: users, operators
area: downloads
action: Optional. To read progress from rTorrent, add it under Settings → Services → Live Download Progress and enter its XML-RPC endpoint, which is usually a ruTorrent /RPC2 path.
breaking: false
---

Live download progress now supports rTorrent. SeerrNG reads speed, progress, and peer counts from rTorrent's XML-RPC interface in one request per refresh, and it never adds, changes, or removes torrents.
