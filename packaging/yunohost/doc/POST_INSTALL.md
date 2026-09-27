Open the installed domain and finish SeerrNG's first-run setup. Connect a
Plex, Jellyfin, or Emby server, then configure the media and automation
services you use in SeerrNG's settings.

The package stores configuration, the database, and logs in YunoHost's
persistent app data directory. YunoHost's Nginx proxy is the only network path
to SeerrNG; the app service listens on localhost. The package enables SeerrNG's
one-hop proxy trust setting so client IPs and secure-request detection work
through YunoHost's local Nginx proxy.
