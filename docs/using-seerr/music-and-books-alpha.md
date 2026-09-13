---
sidebar_position: 20
---

# Music and Books Alpha Validation

SeerrNG adds early music and book request flows on top of Seerr's video request
system. This page is the validation checklist for alpha builds.

## Required Backends

- Lidarr for music requests.
- Bookshelf for book requests. SeerrNG currently talks to Bookshelf through the
  Readarr-compatible API surface. See the
  [Bookshelf Backend](/using-seerr/bookshelf-backend) guide for the recommended
  two-instance ebook/audiobook deployment.
- Jellyfin, Plex, or Emby for the inherited media-server integration. Jellyfin
  music libraries are supported when albums expose MusicBrainz metadata; Lidarr
  remains the automation and fallback availability source.

## Configuration Checklist

1. Add a Lidarr server in **Settings > Services**.
2. Add one Bookshelf server for ebooks in **Settings > Services**.
3. Optional: add a second Bookshelf server for audiobooks and set its format to
   **Audiobook**.
4. Mark one Lidarr server as default.
5. Mark one Bookshelf ebook server as default.
6. If testing audiobooks or both-format requests, mark one Bookshelf audiobook
   server as default.
7. Enable sync on the Lidarr and Bookshelf services being tested.
8. Confirm the root folder, quality profile, metadata profile, and tags returned
   by each test connection are the values expected by the backend.
9. If testing Jellyfin music availability, sync the Jellyfin libraries and
   confirm the albums expose a MusicBrainz release-group or album ID.

## Music Validation

For playlist-to-music request setup and provider limitations, see the
[Playlist Requests](/using-seerr/playlist-requests) guide.

Run these against a real Lidarr instance:

1. Search globally for an album.
2. Open the music detail page.
3. Request the album with default settings.
4. Request another album with advanced overrides.
5. Approve a pending music request.
6. Confirm the album is added in Lidarr with the expected root folder, quality
   profile, metadata profile, and tags.
7. If the download uses an external tagging or staging workflow such as Picard,
   confirm Request Status remains at **Importing** while that work is pending.
   Seerr uses recent Lidarr history when a fast download leaves the live queue
   between polls, so a confirmed Grabbed event must not fall back to
   **Searching**.
8. Confirm the request moves directly to **Available** after Lidarr reports the
   album files. Active requests are checked independently of the broad Lidarr
   scan; enabling scan additionally discovers existing catalogue items at
   startup and during scheduled scans.
9. Remove the item from SeerrNG and confirm Lidarr removal behavior is expected.
10. Retry a failed music request and confirm it dispatches again.

When testing **Request Discography**, include an environment where the default
Lidarr service ID is `0`. The bulk request backend must accept `serverId: 0`;
otherwise SeerrNG rejects the request before it reaches Lidarr.

Jellyfin music scans use the MusicBrainz release-group ID as the canonical album
identity. If Jellyfin exposes only a MusicBrainz album/release ID, SeerrNG
resolves it through MusicBrainz. Albums without either ID are skipped; run a
Lidarr scan when Lidarr is the authoritative availability source.

## Book Validation

Run these against a real Bookshelf instance:

1. Search globally for a book.
2. Open the book detail page.
3. Confirm the ISBN candidate list matches the expected editions.
4. Request an ebook with automatic edition matching.
5. Request an ebook with a specific ISBN/edition selected.
6. Request an audiobook if an audiobook Bookshelf server is configured.
7. Request **Both** if ebook and audiobook Bookshelf servers are configured.
8. Approve pending book requests.
9. Confirm Bookshelf receives the expected root folder, quality profile,
   metadata profile, tags, and monitored state.
10. Trigger a Bookshelf scan in SeerrNG.
11. Confirm ebook and audiobook service links are preserved separately.
12. Remove the item from SeerrNG and confirm both ebook and audiobook backend
    entries are removed when both exist.
13. Retry a failed book request and confirm partial service links are preserved
    when one side already succeeded.

When testing **Request Bibliography**, include an environment where one Bookshelf
service ID is `0`. Book, audiobook, and both-format bulk requests must accept
that service override and dispatch to the correct Bookshelf instance.

## Identity Checks

For every book mismatch, capture:

- Open Library work ID.
- Open Library edition ID.
- ISBN-10 and ISBN-13 candidates shown by SeerrNG.
- Bookshelf lookup term used, when visible in logs.
- Bookshelf foreign book ID and foreign edition ID.
- Whether the requested format was ebook, audiobook, or both.

Known alpha limitation: SeerrNG normalizes valid ISBN-10 values to ISBN-13 and
uses Open Library work/edition IDs plus ISBNs for identity. It does not yet have
a dedicated Hardcover or Bookshelf-native identity provider.

## Pass Criteria

An alpha build is ready for wider tester use when:

- Music requests can be created, approved, scanned, retried, and removed against
  a real Lidarr instance.
- Book requests can be created, approved, scanned, retried, and removed against
  a real Bookshelf instance.
- Audiobook and both-format book requests behave correctly when separate
  Bookshelf defaults are configured.
- Request cards, request lists, notifications, and status badges point users to
  the correct SeerrNG and backend pages.
- No request flow requires entering TMDB, MusicBrainz, Open Library, ISBN, or
  backend IDs manually in normal use.
