# Tester feedback verification

This document records the implementation and verification status for the
SeerrNG preview feedback dated 2026-09-07. It is deliberately separate from
the release changelog: the changelog describes user-visible changes, while
this page records test boundaries and deployment truth.

## Completed feedback items

The request-status, search, retry, deletion, provider-timeout, and terminal
retry fixes from the first seven findings are present in `main`. The remaining
five findings are handled as follows.

### Bounded poster pre-caching

SeerrNG uses the existing authenticated image-cache warming endpoint and sends
requests during browser idle time when image caching is enabled. The client
deduplicates poster URLs before sending them and applies these independent
limits:

- main media lists and the Recently Added section: 100 poster URLs;
- each Discover shelf: 50 poster URLs.

Only poster-like sources are warmed for these views. Backdrops and profile
images are not included in the bounded poster pass. The server still enforces
its own request-size limit, so a malformed client cannot bypass the cap.

### Narrow-window audit

A Cypress audit covers a 390x844 viewport for:

- book search;
- book Discover;
- music Discover; and
- Request Status.

Each scenario asserts that the representative content is visible and that the
document does not exceed the viewport width. This is a regression guard for
horizontal overflow, not a claim that every route has received full manual
mobile acceptance testing. New routes or major layout changes should extend
`cypress/e2e/responsive-media-audit.cy.ts`.

### Music publisher and label metadata

Album details now use the first valid MusicBrainz release identifier available
from ListenBrainz data and request its release labels. Provider output is
bounded to 25 labels, each limited to 256 characters. Multiple labels are
shown as a comma-separated value. If MusicBrainz has no label data, the UI
shows `Not available`; a label-provider failure does not make the album page
fail.

This is intentionally release-label metadata rather than an inferred publisher
field. The MusicBrainz release endpoint is the source of truth for the data
shown in the album details page.

### Live deployment and user acceptance

Local verification is possible with the production build and the Cypress test
server. A live production deployment and full user-acceptance pass are not
claimed here because the deployment host backed by the LVM environment is
offline. Release artifacts can still be built and tested, but deployment must
be rechecked after that host returns:

1. deploy the built SeerrNG and BookshelfNG artifacts;
2. verify administrator and non-administrator Request Status views;
3. request and import at least one book and audiobook;
4. verify an imported item becomes Available;
5. verify a failed/no-release item becomes Unavailable without an automatic
   retry; and
6. check narrow-window behavior on a real browser and device.

### Bookshelf filename matching

BookshelfNG now permits title-only remote searches when author tags are absent.
For a single delimiter-free multiword filename with no author metadata, the
filename aggregator keeps the complete name as the title instead of treating
the first word as an author. If an ambiguous filename still produces a partial
title, the candidate service retries with the normalized complete filename
before trying an author-only search.

The regression coverage includes both `Rogue Elements.epub` and
`Rogue Elements.m4b`, plus a candidate search using the complete filename.
This logic is shared by the book import path; it does not depend on whether
the requested physical edition is hardcover or softcover.

## Verification commands

SeerrNG focused verification:

```bash
node server/test/index.mts \
  server/api/musicbrainz.test.ts \
  server/routes/music.test.ts \
  src/hooks/useWarmImageCache.test.ts \
  server/lib/imageCacheUrls.test.ts \
  server/routes/imageproxy.test.ts
pnpm typecheck:server
pnpm typecheck:client
pnpm exec cypress run --spec cypress/e2e/responsive-media-audit.cy.ts
```

BookshelfNG focused verification:

```bash
DOTNET_ROLL_FORWARD=Major dotnet test \
  src/NzbDrone.Core.Test/Readarr.Core.Test.csproj \
  --no-restore \
  --filter "FullyQualifiedName~CandidateServiceFixture|FullyQualifiedName~AggregateFilenameInfoFixture"
```

The BookshelfNG command used the installed .NET runtime's major-version
roll-forward because this workstation does not have the .NET 6 runtime. The
project compiled and all 61 selected tests passed. A normal CI or developer
machine with the target runtime should omit that environment override.
