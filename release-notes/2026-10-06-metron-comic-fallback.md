---
category: added
audience: users, operators
area: comics
action: Optional. To use Metron, create an API token at metron.cloud and enter it under Settings → General → Metron API Token.
breaking: false
---

Comic search now falls back to Metron when ComicVine search is unavailable or returns an error. Results come only from series that have a ComicVine ID, so requests keep working with the same identifiers. Comic details still require ComicVine.
