---
category: fixed
audience: users, operators
area: authentication
action: none
breaking: false
---
Installations using the default HTTP listener can now sign in and keep browser sessions with a visible network warning, while HSTS is sent only over HTTPS. Set `SEERR_ALLOW_HTTP_AUTH=false` when direct browser access must require HTTPS.
