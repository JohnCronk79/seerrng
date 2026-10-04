---
category: security
audience: users, operators
area: authentication
action: review-and-choose-transport
breaking: false
---
Fresh installations can choose built-in self-signed HTTPS, a provided
certificate, or an explicitly acknowledged trusted-LAN HTTP fallback before
first login. Administrators can change the mode in Settings > Network, verify
HTTPS before enabling redirects, and recover from certificate errors with the
documented environment override. Existing installs are unchanged.
