---
category: changed
audience: operators
area: library-scanning
action: none
breaking: false
---
Background library scans now use a separate bounded TMDB cache for lookup data, reducing repeated metadata traffic and limiting cache growth.
