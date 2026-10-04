---
category: fixed
audience: users, operators
area: authentication
action: none
breaking: false
---
Fixed the root cause of CSRF protection's "invalid csrf token" errors: an untrusted forwarded-protocol header could mark the CSRF cookies `Secure` on a connection the browser saw as plain HTTP, causing it to silently drop them. That header is now only trusted when "Enable Proxy Support" is on.
