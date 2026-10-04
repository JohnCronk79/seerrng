---
category: fixed
audience: users, operators
area: discovery
action: none
breaking: false
---
Book discovery and author bibliography pages no longer fail outright when Open Library responds slowly; the internal timeout that guards those requests now allows as long as the request itself is permitted to take.
