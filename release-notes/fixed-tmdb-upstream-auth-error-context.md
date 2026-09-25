---
category: fixed
audience: operators
area: metadata
action: none
breaking: false
---
Provider failures behind movie and discovery errors now retain the upstream status, provider message, and error code in server logs. TMDB rejections also show the credential source without exposing the key, helping operators distinguish authentication failures from network outages.
