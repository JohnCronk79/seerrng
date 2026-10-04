---
category: fixed
audience: users, operators
area: authentication
action: none
breaking: false
---
The Jellyfin/Emby setup wizard now accepts private/LAN hostnames by default, matching how the vast majority of self-hosted media servers are actually reachable. Set `SEERR_REQUIRE_PUBLIC_SETUP_HOSTS=true` to restore the stricter public-hostname-only check.
