---
category: fixed
audience: operators
area: metadata
action: If startup logs report HTTP 401, remove or correct the TMDB credential override.
breaking: false
---
SeerrNG now checks TMDB authentication after startup and logs whether it succeeded, which credential source was used, or the upstream HTTP/network failure code. A rejected override is visible without exposing the key; the bundled key remains the default.
