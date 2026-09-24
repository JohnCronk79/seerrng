---
title: Bookshelf Metadata Sources and Migration Recovery
description: Supported metadata paths, recovery providers, configuration, caching, and source identity behavior.
sidebar_position: 23
---

# Bookshelf Metadata Sources and Migration Recovery

This page separates three capabilities that are easy to conflate:

1. **Bookshelf runtime metadata** powers normal searches, author pages, book
   details, edition lookups, and imports.
2. **SeerrNG migration recovery** reads an existing Readarr/Bookshelf library,
   searches metadata sources for missing records, and maps safe matches to a
   new Hardcover-backed library.
3. **Local fallback records** preserve a book in Bookshelf when a native
   Hardcover record cannot be safely resolved.

Google Books, Library of Congress, Europeana, and Apify Goodreads-compatible
search can also serve normal BookshelfNG runtime searches when enabled. SeerrNG
receives provider-qualified IDs through its configured Bookshelf/Readarr
services and preserves the service and source identity through search,
details, and book requests.

## Support matrix

| Source or path | Ordinary Bookshelf search/details | Migration recovery | Authentication and cost | Notes |
| --- | --- | --- | --- | --- |
| Hardcover native | Yes, in the `hardcover` image when `HARDCOVER=true` | Yes; primary target for remapping | Hardcover token; subject to Hardcover service availability and limits | Bookshelf-native Hardcover IDs are used for works, authors, and editions. |
| rreading-glasses / compatible `METADATA_URL` | Yes, when configured as the Bookshelf metadata endpoint | Yes, when configured as a Bookshelf/Softcover recovery endpoint | Depends on the hosted or self-hosted endpoint | A compatible endpoint must implement the API Bookshelf expects. |
| Goodreads-compatible / Softcover | Yes, through the compatible Bookshelf mode/image | Yes, when its endpoint is configured | Provider-specific; Goodreads no longer issues public API keys | Legacy Goodreads IDs remain provider-specific and cannot be converted by changing the image tag. |
| Open Library | Yes; SeerrNG queries it directly alongside configured Bookshelf services | Yes | No key for basic API access; observe Open Library's published low-volume request policy | Search results provide a fallback when a Bookshelf source is unavailable, subject to SeerrNG's provider deadline. |
| Google Books | Yes, enabled in BookshelfNG when `GOOGLE_BOOKS_API_KEY` is set; SeerrNG uses it through BookshelfNG | Yes | Public data requires a Google API key; no user OAuth is needed for this search | Can supply identifiers, descriptions, publisher, language, dates, page count, and cover URL. |
| Library of Congress | Yes, enabled by default in BookshelfNG unless an explicit source list overrides it; SeerrNG uses it through BookshelfNG | Yes | Public JSON API; no key; requests are paced to one per 3.2 seconds per Bookshelf process | Available language metadata is retained for BookshelfNG's edition-language profiles. The `/books/` endpoint searches LoC's digitized collection and is not the complete LoC book catalog. |
| Goodreads-compatible Apify Actor | Yes, opt-in in BookshelfNG; SeerrNG uses it through BookshelfNG | Optional migration adapter | Apify token required; Actor availability and pricing depend on its publisher | Actor schemas differ. Supply a JSON input template that contains `{{query}}`. |
| Europeana | Yes, optional in BookshelfNG when `EUROPEANA_API_KEY` is set; SeerrNG uses it through BookshelfNG | Not wired into the migration helper | Free API key; results are limited to openly reusable text records; provider terms apply | Europeana is a runtime search source only; it does not replace Hardcover or merge records into the primary catalog. |
| Japan NDL Search, OpenBD, Internet Archive | No | Not wired into the migration helper | Varies by service; some require a free key, and request policies differ | Candidate future integrations; not implemented in BookshelfNG runtime or migration recovery. |

“Free” describes API access, not an unlimited service guarantee. Google applies
quotas; Open Library asks applications to respect its request policy; Europeana
requires an API key; and Apify can charge for Actor compute or results. Check
each provider's current terms and limits before operating at scale.

Goodreads stopped issuing new public developer keys and has retired or
restricted access to its public API. The adapter described here calls an
Apify Actor selected by the operator; it is not an official Goodreads API
client. See the [Goodreads Developers notice](https://www.goodreads.com/group/show/8095-goodreads-developers),
[Apify run Actor API](https://docs.apify.com/api/v2/acts-runs-post), and
[Apify dataset items API](https://docs.apify.com/api/v2/actor-run-get-dataset-items).

## Runtime metadata behavior

BookshelfNG has two broad runtime paths:

- The Hardcover image can use BookshelfNG's native Hardcover provider. Native
  provider IDs are kept in Bookshelf's work, author, and edition fields.
- A Readarr-compatible metadata endpoint can be selected with `METADATA_URL`;
  in the Hardcover image, setting `HARDCOVER_NATIVE=false` selects that path.
  This endpoint must implement the BookInfo-compatible search and detail
  behavior Bookshelf expects.
- A standalone Hardcover image queries LOC alongside Hardcover by default. It
  also queries Google Books and Europeana when their API keys are configured.
  A selected Apify Goodreads-compatible Actor is queried only when explicitly
  enabled. `BOOKSHELF_METADATA_SOURCES` replaces these defaults; setting it to
  an empty value disables all additional Bookshelf catalogs. The managed
  SeerrNG two-instance deployment enables LOC only on its audiobook service
  by default, then permits separate overrides with
  `BOOKSHELF_EBOOKS_METADATA_SOURCES` and
  `BOOKSHELF_AUDIOBOOKS_METADATA_SOURCES`. See the BookshelfNG README for
  credentials, cache lifetimes, request pacing, and the Actor input template.

SeerrNG merges Open Library search results with results from configured
BookshelfNG services. Each Bookshelf result uses a service-qualified SeerrNG ID
that wraps the Bookshelf foreign ID. Details are resolved through that same
service, and request admission carries the identity into Bookshelf lookup;
ISBNs are retained as cross-source matching identifiers when available.
Google volume IDs, LOC record identifiers, Europeana record IDs, and Apify
Actor record IDs are not coerced into Goodreads integers or Open Library keys.

The compatibility proxy's cache is distinct from migration recovery's file
cache. The former serves runtime metadata requests. The latter is a local
JSON artifact inside the migration directory and is only used by the migration
helper.

## Migration recovery flow

For each unmatched source record, the migration helper:

1. Searches configured Softcover/Goodreads-compatible data when available.
2. Searches Open Library using title, author, and identifiers.
3. Searches Google Books and the Library of Congress.
4. Optionally runs a configured Apify Actor against a title/author query and,
   when present, at most one ISBN query.
5. Uses recovered profiles as candidate search terms against the target
   Hardcover Bookshelf API.
6. Imports only candidates that pass strict identity matching. A provider hit
   by itself does not authorize a remap.
7. Leaves unresolved records in the unmatched report or creates an explicitly
   enabled local Bookshelf fallback record.

The providers are best-effort: an unavailable source is logged and the helper
continues with other recovery providers. Open Library can be disabled with
`HARDCOVER_OPENLIBRARY_RECOVERY=false`; Google Books and LOC have independent
switches. Apify is disabled unless both its Actor ID and token are configured.

Recovered local metadata is kept on the migration source record. The direct
SQLite fallback writes the available description, publisher, page count,
language, release date, and cover URL into the Bookshelf record where the
database schema provides those fields. A later successful native match can
reconcile a shadow local record in place, preserving the library row instead
of creating a duplicate.

## Default sources and configure Google Books and Europeana

Library of Congress is queried by default in a standalone BookshelfNG
deployment and needs no API key. Its public JSON API enforces rate limits;
Bookshelf paces requests to one per 3.2 seconds per process and caches
successful search/detail responses for one day. Two Bookshelf processes sharing
an outbound IP should avoid both querying LOC. The SeerrNG installer handles
this by enabling LOC on the audiobook instance by default and leaving the
ebook instance on Google Books and Europeana when keys are available. Set
`BOOKSHELF_EBOOKS_METADATA_SOURCES` and
`BOOKSHELF_AUDIOBOOKS_METADATA_SOURCES` for per-service overrides, or use the
legacy `BOOKSHELF_METADATA_SOURCES` variable as a shared override when running
the installer.
Set both per-service variables to an empty value to disable the additional
catalogs in both containers.

Google Books is enabled automatically when its API key is present. Public API
requests require a project key; no OAuth user authorization is needed. The key
is free to create, but API usage is subject to Google quota and terms.

Europeana is enabled automatically when its API key is present. The key is
available without charge after account registration. Runtime search filters
to text records with open reuse status; metadata and cover availability still
vary by contributing institution. Europeana is strongest as a multilingual
cultural heritage fallback, not as a complete current-book catalog.
See Europeana's [Search API](https://europeana.atlassian.net/wiki/spaces/EF/pages/2385739812/Search+API+Documentation),
[Record API](https://europeana.atlassian.net/wiki/spaces/EF/pages/2385674279/Record+API+Documentation),
and [API key registration](https://pro.europeana.eu/page/get-api) guidance.

```env
GOOGLE_BOOKS_API_KEY=your-google-books-api-key
EUROPEANA_API_KEY=your-europeana-api-key
HARDCOVER_LOC_RECOVERY=true
```

To override runtime defaults, set `BOOKSHELF_METADATA_SOURCES` on a standalone
BookshelfNG container or use the ebook/audiobook-specific source variables in
the SeerrNG installer. Supported values are `googlebooks`, `loc`,
`europeana`, and `apify-goodreads`; use a comma-separated list. An explicitly
empty value disables additional runtime catalogs for the relevant instance.
These runtime variables are separate from the migration switches shown below.

Without `GOOGLE_BOOKS_API_KEY`, Google Books recovery logs that it is skipped.
The helper queries up to 10 Google Books volumes and 10 LOC results per query.
Google/LOC response profiles are cached for 30 days in
`<migration-directory>/catalog-cache.json`. The cache contains bibliographic
metadata and image URLs, not provider credentials. Keep the migration
directory private if the source catalog contains sensitive library data.

Use `HARDCOVER_GOOGLEBOOKS_BASE_URL` and `HARDCOVER_LOC_BASE_URL` only for a
controlled compatible endpoint or test server. Normal deployments should use
the default public API origins.

## Configure the Apify Goodreads-compatible adapter

Goodreads' public developer API is unavailable to new integrations. The
optional Apify adapter runs an Actor that you select; SeerrNG does not provide,
operate, or guarantee a particular scraper.

```env
HARDCOVER_APIFY_GOODREADS_ACTOR=publisher~goodreads-scraper
HARDCOVER_APIFY_TOKEN=your-apify-token
```

The default Actor input is:

```json
{"searchQueries":["TITLE AUTHOR"],"maxItems":10}
```

The helper replaces every literal `{{query}}` in the configured JSON template
with a JSON-escaped query string. Example for an Actor that expects `queries`
and `resultsLimit`:

```env
HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE={"queries":[{{query}}],"resultsLimit":10}
```

The template must be valid JSON after replacement and contain `{{query}}`.
It may not exceed 16,384 characters. Actor IDs may use `publisher~actor-name`
or an actor ID. Actor output fields are normalized from common names such as
`title`, `fullTitle`, `author`, `authors`, `isbn13`, `description`,
`coverImage`, and `goodreadsId`; unsupported Actor output shapes are ignored
rather than treated as matches.

Actor results are cached for seven days. The adapter makes no more than two
Actor runs per source item (title/author and one ISBN when available). Each
Actor can still have its own runtime, result, and platform charges. Review the
Actor's code, input schema, output schema, privacy behavior, and pricing before
using it with a library. Do not put a Goodreads password or session cookie in
the Apify token field.

## Local fallback identity and reconciliation

Local fallbacks are ordinary Bookshelf database/API records with deterministic
local IDs, for example `local:ebook:1076`; ISBN-backed synthetic entries may
also use an `isbn:` foreign ID. They are **not Hardcover catalog entries** and
do not appear in Hardcover itself. The fallback is opt-in because it writes
directly to a Bookshelf SQLite database when API adds cannot preserve a book.

To enable it for a reviewed migration:

```bash
APPLY_HARDCOVER_REBUILD=true \\
HARDCOVER_LOCAL_DB_IMPORT=true \\
deploy/install-bookshelf-backend.sh --migrate-to-hardcover
```

Keep backups and run the normal migration validation before cutover. Later,
`--reconcile-local` retries strict native Hardcover matching and promotes
eligible local rows in place. See the [migration runbook](./bookshelf-hardcover-migration.md)
for preflight, backup, review, validation, restore, and cutover steps.

## Migration variables

These variables are read by `deploy/bookshelf-hardcover-migration.mjs`, not
by the SeerrNG runtime server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HARDCOVER_OPENLIBRARY_RECOVERY` | `true` | Enable Open Library recovery. |
| `HARDCOVER_GOOGLEBOOKS_RECOVERY` | `true` | Enable Google Books recovery. |
| `GOOGLE_BOOKS_API_KEY` | unset | Required to use Google Books public data search; no OAuth user token is needed. |
| `HARDCOVER_LOC_RECOVERY` | `true` | Enable Library of Congress recovery. |
| `HARDCOVER_APIFY_GOODREADS_ACTOR` | unset | Apify Actor ID; leaves the adapter disabled when empty. |
| `HARDCOVER_APIFY_TOKEN` | unset | Bearer token used for Apify API calls. |
| `HARDCOVER_APIFY_GOODREADS_INPUT_TEMPLATE` | `{"searchQueries":[{{query}}],"maxItems":10}` | Actor-specific JSON input template. |
| `HARDCOVER_APIFY_API_BASE_URL` | `https://api.apify.com` | Apify API origin; must remain the official HTTPS API host. |
| `HARDCOVER_GOOGLEBOOKS_BASE_URL` | `https://www.googleapis.com` | Google Books API origin override. |
| `HARDCOVER_LOC_BASE_URL` | `https://www.loc.gov` | LOC API origin override. |
| `HARDCOVER_LOCAL_DB_IMPORT` | `false` | Enable direct local Bookshelf SQLite fallback after API recovery fails. |

To see all migration and deployment settings, see the [Bookshelf backend
guide](./bookshelf-backend.md) and the [migration runbook](./bookshelf-hardcover-migration.md).

## Future provider candidates

The following services were identified as possible free or freely accessible
catalogs, but **are not implemented adapters** in this migration helper or
BookshelfNG runtime. Each needs source-specific identity mapping, request
policy, error handling, response normalization, cache behavior, and tests
before it should be described as supported:

- **Japan National Diet Library Search (NDL Search)**: SRU, OpenSearch,
  OpenURL, and OAI-PMH interfaces cover metadata from participating providers.
  Some data use requires prior application, and coverage is limited to
  metadata that providers permit. See [NDL Search API specifications](https://ndlsearch.ndl.go.jp/help/api/specifications)
  and [English usage terms](https://ndlsearch.ndl.go.jp/en/help/api/).
- **OpenBD**: Japanese book catalog metadata. The documentation found for this
  review is dated, so verify service health, current coverage, and terms before
  relying on it. See the [OpenBD API document](https://openbd.jp/pdf/openBD_doc_20170123.pdf).
- **Internet Archive**: public item metadata/search surfaces, but book-edition
  identity and artwork suitability vary by item. See [Internet Archive item
  search APIs](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html).

The [Google Books API](https://developers.google.com/books/docs/v1/using)
requires an API key or OAuth token to identify public API requests; this
adapter uses an API key and does not access private user data. The
[Library of Congress JSON API](https://www.loc.gov/apis/json-and-yaml/) needs
no API key, but is rate limited and the `/books/` endpoint covers digitized
books rather than the entire LoC catalog. [Open Library's API policy](https://openlibrary.org/developers/api)
asks clients to cache, identify themselves, and keep use low-volume; it states
that the API is not intended as a high-traffic third-party data backend.

The candidates above remain possible future integrations. They should not be
configured as runtime Bookshelf sources until adapters can retain and resolve
their native IDs through search, detail, author, and edition endpoints.
Europeana is already available for runtime search when `EUROPEANA_API_KEY` is
configured, but is not part of migration recovery.
