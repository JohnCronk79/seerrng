# SeerrNG for YunoHost

This YunoHost package installs SeerrNG's prebuilt Linux release archives. It
supports `amd64` and `arm64`, uses YunoHost's Node.js 22 runtime, and stores
persistent application data in the YunoHost app data directory.

The YunoHost package source is maintained at
[`packaging/yunohost`](https://github.com/snapetech/seerrng/tree/main/packaging/yunohost).
The `yunohost` branch exposes that package directory at the repository root so
YunoHost can install it directly:

```bash
sudo yunohost app install https://github.com/snapetech/seerrng/tree/yunohost --debug
```

The app requires a dedicated domain root because SeerrNG does not support URL
subpaths. The package does not integrate with YunoHost LDAP or portal SSO.
See [`doc/`](doc/) for install, admin, and service details.
