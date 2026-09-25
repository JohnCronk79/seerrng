---
title: Magazines Backend
description: Configure LazyLibrarian for magazine discovery, requests, and issue status.
sidebar_position: 25
---

# Magazines Backend

SeerrNG handles magazine discovery, requests, permissions, quotas, and request
status. Configure [LazyLibrarian](https://lazylibrarian.gitlab.io/) in SeerrNG
to add requested titles and track downloaded issues.

## Configure LazyLibrarian

1. In LazyLibrarian, open **Config > Interface** and copy its API key. Use a
   write-enabled key; a read-only key cannot add magazines or start searches.
2. In SeerrNG, open **Settings > Services** and add a LazyLibrarian server.
3. Enter the LazyLibrarian host, port (usually `5299`), and API key, then test
   the connection.
4. Mark one instance as the default if you configure multiple servers.
5. Enable **Library Scan** to sync tracked magazines and issue availability
   into SeerrNG.

Set the magazine folder, download providers, and search behavior in
LazyLibrarian itself. The **Search automatically after approval** option in
SeerrNG starts a search for the requested title after an administrator approves
it (or immediately when the request is auto-approved).

## Discover and request titles

The Magazines page lists titles already tracked by configured LazyLibrarian
instances. Global Search also has a **Magazines** category that searches the
tracked title catalogs across configured instances. Enter a main search query
to find titles; the category can further narrow the displayed matches by title
or latest issue. To request a title that is not listed, choose **Request
Magazine** and enter its title. LazyLibrarian adds that title to its own
magazine list.

SeerrNG checks requests and availability by a normalized title, so requests
that differ only in case or repeated whitespace resolve to the same magazine.
The magazine details page shows issue dates and whether each issue has a file.

## Permissions and quotas

Administrators can grant **Request Magazine** and **Auto Approve Magazine** in
user permissions. A global magazine request limit can be set in **Settings >
Users**. Users see their current usage in the request form and profile.

## Troubleshooting

Magazine discovery is empty:

- Confirm that at least one LazyLibrarian server is configured in **Settings >
  Services**.
- Enable **Library Scan** and add or import magazine titles in LazyLibrarian.
- For a title not already tracked, enter its name with **Request Magazine**.

Connection tests fail:

- Confirm the host, port, API key, SSL setting, and URL base match
  LazyLibrarian's configuration.
- Make sure SeerrNG can reach LazyLibrarian over the configured network.
