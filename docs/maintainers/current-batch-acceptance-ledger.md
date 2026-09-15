# SeerrNG Outstanding Work Ledger

This file is the single authoritative list of unfinished SeerrNG work retained
for John Cronk. Completed work belongs in Git history and release notes, not
this file.

Baseline reviewed on 2026-09-14: SeerrNG `v3.21.2`, commit
`e677ebf3451d0ddcf95bfbeb7f7715bd56f757ff`.

Task-capture rule: a message prefixed with `task:`, `feature:`, `bug:`, or
`issue:` is an instruction to preserve the complete item on the task list. The
tag alone is not authorization to begin implementing it. Implementation begins
only when the user later places that item into an active batch or explicitly
asks for the work to start.

## New v3.21.2 corrections

### Poster overlay alignment

> “task: fix the poster display so media type badget, association button and availability are aligned”

- Status: Implemented in source and protected by focused helper and current-batch
  contracts. A fresh build and rendered desktop/narrow verification remain
  pending under John's no-build gate.
- The media-type badge remains on the first row at left. Associations occupies
  the second row at left. HD or MP3 holds the first-row right slot, while 4K or
  FLAC holds the second-row right slot even when the first slot is empty.
- The same fixed slots render available, pending-approval, processing, and
  active-download states without shifting neighboring controls.

### Poster overlay shadows

> “task add shadow to poster icons and text.”

- Status: Open task; captured but not yet started.
- Add the shadow through the shared poster-overlay style rather than copied or
  inline styling. Preserve semantic colors and confirm that icons, badges, and
  text remain legible over both light and dark artwork.
- Verify normal, hover, focus, selected, available, unavailable, and disabled
  poster states when this task becomes active.

### Poster Associations styling

> “apply the same style that we used on the associations button in this image to the associations icon on the poster.”

- Status: Implemented in source and protected by the focused current-batch
  contract. The association control has moved to its second-row position; a
  fresh build and rendered poster verification remain pending.
- The compact poster action reuses the shared aqua Associations button style
  while retaining its circular size, artwork blur, and shadow. The existing
  popover, tooltip, visibility rules, and click behavior remain unchanged.

### Poster available-quality control

> “put the check mark and text inside a button. the style of the button will be the same as the request button ... keep the text inside the button green ... availability icon ... to the right of the text.”

- Status: Implemented in source and protected by the focused current-batch
  contract. The source has changed since the prior successful build, so a fresh
  build and rendered poster verification remain pending.
- HD, 4K, MP3, and FLAC use compact rounded status badges matching the media-type
  badge silhouette. Available formats stay green with the outlined availability
  icon after the quality label.
- Pending approval uses the bell badge; approved/processing uses the timer
  badge. Music request targets are resolved separately so MP3 and FLAC retain
  their correct first- and second-row positions. Unknown, blocked, and deleted
  quality states do not create an availability badge.
- The bell tooltip identifies the state as pending approval, while the timer
  tooltip identifies it as approved and processing. Both include the affected
  HD, 4K, MP3, or FLAC format.

### Media-detail disclosure spacing and subcard contrast

> “there is no space between the overview card and the view cast button row. please make it the same space as between the button row and the movie details card.”
>
> “make the sub cards on all pages a little bit darker ... just the subcards like the overview card.”

- Status: Implemented in source and protected by the focused current-batch
  contract. The fresh production build passed; rendered cross-page verification
  remains pending.
- Disclosure rows use the same five-pixel spacing above and below. The shared
  inset/subcard surface opacity increased from 32 to 42 percent, while the
  outer/main card surface is unchanged.

### Main-menu cleanup

> “task: remove request stat main menu item, as well the dupicate audiobooks item.”

- Status: Implemented in source and protected by the focused current-batch
  contract. The source has changed since the prior successful build, so a fresh
  build and rendered desktop/mobile verification remain pending.
- Remove the Request Status entry from the main navigation and remove the
  duplicate Audiobooks entry. Preserve the distinct main Requests entry and the
  underlying Request Status and Audiobooks routes and functionality unless John
  explicitly requests their removal.
- The desktop Sidebar and Mobile Menu now each contain exactly one Audiobooks
  entry, exactly one main Requests entry, and no Request Status entry. All
  underlying routes remain present.

### Filter control and reset corrections

> “the white buttons in the image have lost their correctly style.”
>
> “the clear filters button should also reset the default sort order, make this site wide please”

- Status: Implemented in source and protected by the current-batch contract. A
  fresh build and rendered verification remain pending under John's no-build
  gate.
- Compact third-party selectors now explicitly retain the shared dark control
  surface instead of falling back to their white library default.
- Clear Filters restores each page's native default sort as well as its other
  filters across Movies, Series, Music, Books, Search, Requests, Blocklist, and
  Issues.
- Movie HD and 4K availability filters use the current cached Radarr library
  state when the matching synchronized service is configured. Only movies with
  an actual Radarr file are returned; monitored entries without files and stale
  copied-database availability are excluded. Cards use Radarr title metadata
  and the authenticated Radarr cover proxy instead of blank TMDB-ID fallbacks.
- The live Movie filter loads persisted Seerr relationships only for the 20
  visible results after filtering, sorting, and pagination, keeping the full HD
  library lookup bounded. Focused route and cover-proxy tests protect this
  behavior. A fresh build and rendered verification remain pending under
  John's no-build gate.

## Keith-requested feature

- Status: Open intake. Keith has requested a new feature, but its exact
  behavior and acceptance criteria have not yet been supplied.
- Preserve Keith's original wording and link to its GitHub issue, discussion,
  or comment when John provides it. Do not infer the feature from unrelated
  upstream changes.

## Hardcover-enriched Book search

> “the idea of integrating hard cover into the book search”

- Status: Future feature. Preserve this as a distinct Book-search project; the
  existing Bookshelf Hardcover backend and migration support do not by
  themselves complete it.
- Investigate using Hardcover metadata in SeerrNG's visible Book and Audiobook
  discovery/search experience. Before implementation, jointly decide whether
  Hardcover supplements Open Library, acts as a fallback, or becomes an
  explicitly selectable provider.
- Inventory the fields and identifiers available from both providers and define
  deterministic matching, de-duplication, edition/format handling, artwork,
  author links, ratings, series, subjects/genres, and result ordering.
- Preserve the established `All Books | Books | Audiobooks` behavior, keyword
  relevance, filters, sorting, Back restoration, request routing, and existing
  library/request state when combining or switching provider results.
- Design authentication, rate-limit, timeout, caching, attribution, and partial
  provider-failure behavior before enabling live traffic. Never expose a
  Hardcover credential to the browser or logs.
- Add provider, route, matching, failure, responsive, and rendered-result checks
  when this feature becomes active.

## Music artist page refresh

> “feature: when you look at a music artist details, the page needs a maor refresh including filters and sort order etc.”

- Status: Future feature, explicitly deferred by the user.
- Design the detailed layout, filters, and sort choices with John when this
  feature becomes active.
- Resolve the oversized empty Similar Artists region without removing its
  empty-state meaning or any existing discography, request, association, or
  navigation behavior.

## Series IMDb ratings integration

- Status: Future feature, explicitly deferred by the user.
- Sonarr's generic Series rating is not identified as IMDb and must not be
  labeled as IMDb.
- Use only a trustworthy licensed or deliberately implemented bulk-dataset
  source. Do not scrape IMDb pages.
- Preserve the existing Rotten Tomatoes critic, Rotten Tomatoes audience, and
  TMDB ratings until the separate IMDb integration is designed and verified.

## Pinned Cast, Crew, and Tags disclosures

> “feature: add a pin to the cast crew and tags button on the media details page.”

- Status: Implemented in source with database, API, optimistic-client,
  accessibility, and focused contract coverage. The earlier production build
  passed before the pushpin refinement; that icon change remains source-only
  until the next explicitly requested laptop build.
- Cast, Crew, and Subject Tags each have an independent pin segment to the left
  of the disclosure label. The control uses a conventional angled menu
  pushpin, not a map-location pin. Selected pins use a solid icon and
  `aria-pressed`; unselected pins use an outline icon and an explanatory
  tooltip.
- A pinned disclosure defaults open across Movie, Series, and Collection
  details. Subject Tags also carries into Music details. Users may temporarily
  collapse a pinned section during the current page visit; it opens again on
  the next applicable page.
- Persist all three preferences on the existing per-user settings record and
  expose them through the authenticated `/settings/detail-disclosures`
  endpoint. The settings survive navigation, devices, and later logins.
- Preserve existing disclosure content, ordering, visibility, responsive
  behavior, and unpinned expand/collapse behavior.

## Request-card contrast and Advanced Options

> “set it so the advanced options are always visible ... make the advanced options card scrollable if and when the number of root folders are more than 5 items long ... use our site background here ... use the same style as the destination dropdown button ... make the horizontal lines and the divider lines the same dark blue.”

- Status: Implemented in source and protected by the focused current-batch
  contract. The earlier production build passed before these latest requester,
  dropdown, and divider refinements; they remain source-only until the next
  explicitly requested laptop build.
- Fresh Movie, Series, Music, and Book request forms open Advanced Options by
  default; the older Collection, bulk, and edit-request presentation keeps its
  Advanced Options content open.
- Root-folder data rows scroll only when more than five exist, with the table
  heading left visible. Request-card rules and details dividers are two pixels
  wide and match the `gray-900/70` Destination Server value background.
- Advanced Options, Requested By, Cast, Crew, and Subject Tags controls share
  the darker Destination Server control treatment while retaining their compact
  sizes and behavior.
- Destination Server and Quality Profile use the same translucent blue
  Listbox treatment, bright hover state, and selected-option checkmark as
  Requested By. Their value segments stay transparent so the shared surface is
  not made artificially opaque by stacked backgrounds.
- Request managers see every Seerr account in Requested By and may create a
  request for an account that lacks that tier's self-request permission.
  Approval and quota behavior still follow the selected account.
- Full-size request modal surfaces use the site background gradient. Inner
  artwork-backed request cards preserve their artwork and readability layers.

## Firefox detail-card artwork resize stability

> “when the cast and crew cards are opened ... when he collapses the cards and reopens them his browser keeps zooming the background image ... he uses Firefox.”

- Status: Implemented in source with a browser-scoped contract. The fresh
  production build passed; Firefox rendering remains to be confirmed by Keith
  in the laptop preview.
- Preserve the intended expanding `cover` artwork behavior. In Firefox only,
  render the same resolved cached artwork URL through a stable CSS background
  layer and suppress the replaced-image paint path that accumulates zoom.
- Chrome and other browsers retain the existing image rendering path.

## Series collections and franchise groups

> “agreed, put that as a feature: and add it to our task list.”

- Status: Future feature, explicitly deferred by the user.
- Use the Associations system as the likely foundation for grouping spin-offs,
  prequels, sequels, and shared-universe titles, including possible cross-media
  relationships.
- Jointly decide how membership is sourced or curated, how groups are named and
  represented, where they appear, and how they differ from recommendations,
  similar titles, networks, and ordinary associations.
- Do not infer or silently discard uncertain relationships.

## Collection request-page refresh and cross-media collections

> “feature: refresh request page from collection page for both movies and series. possibly build the same for music and books.”

- Status: Future feature, explicitly deferred by the user.
- Refresh the request flow opened from a Collection page for Movie and Series
  while preserving permissions, availability, HD/4K targets, partial
  collections, approval, service, profile, root-folder, retry, cancel, and
  request-history behavior.
- Inventory whether each entry point represents a provider collection, SeerrNG
  association, or another grouping source before treating them alike.
- Evaluate equivalent Music and Book grouping requests with John. Do not invent
  album/discography, series/edition, Book/Audiobook, or cross-format semantics.
- Validate mixed availability, existing requests, partial collections, and
  different permission/automatic-approval combinations on desktop and narrow
  layouts.

## Deferred requested-Movie View Request refresh

> “feature: on a movie detail page for a movie that has been requested the view request page needs a refresh.”

- Status: Future feature, explicitly deferred by the user.
- Inventory the requested-title entry point and every status, approval, retry,
  history, cancel, delete, service, format, permission, and return-navigation
  behavior before proposing the refreshed layout.

## Deferred media-detail action-row redesign

> “feature: edit the button rows on the media details page, the button alignment and spacing is just wrong especially when you factor in hidden buttons or buttons that only show up if you an admin.”

- Status: Future feature, explicitly deferred by the user.
- The approved wrapping action row remains the baseline until this broader
  redesign is jointly reviewed.
- Test administrator, automatic-approval, ordinary requester, 4K-capable,
  unavailable-media, missing-capability, and permission-hidden states across
  Movie, Series, Music, Book, and Collection details.

## Deferred refresh of pages not yet redesigned

> “please put the refresh of unknown pages in out task list so we do it later once we finalize what we did actually do. keep your notes above with that task so you know the rules to follow when you perform it.”

- Status: Future task, explicitly deferred by the user.
- Derive proposed layouts from the approved pages and cards,
  `docs/maintainers/ui-style-standard.md`, and the repository validator rather
  than starting from zero.
- Reuse established cards, controls, spacing, colors, translucency, artwork,
  responsive behavior, and interactions wherever their semantics match.
- Preserve every field, detail, button, task, card, link, and capability unless
  its replacement or removal is certain.
- Record every uncertain element for joint manual review, including its current
  purpose, proposed treatment, uncertainty, and required decision.
- Keep user-directed requirements separate from inferred design proposals.
- Expand validator coverage and visually inspect desktop and responsive states
  as each future page is refreshed.

### Known deferred areas

- **People `/person/[personId]`:** preserve hero artwork/fade, portrait, name,
  social links, birth details, alternate names, biography, credit selector, and
  Crew/Appearances sliders while reconciling the artwork treatment with the
  contained-card standard.
- **Artists `/artist/[artistId]`:** preserve the portrait, Artist badge,
  country, Request Discography, Similar Artists, release-group categories,
  album cards, filters, sorting, requests, associations, and navigation. This
  overlaps the dedicated Music artist refresh above.
- **Authors `/author/[authorId]`:** preserve portrait fallback, biography,
  Request Bibliography, Bibliography cards, author/work links, metadata, and
  unknown-image behavior.
- **Manage Movie/Series slide-overs:** preserve Open in Radarr/Sonarr, removal,
  normal/4K availability actions, Clear Data, warnings, confirmations, and
  permission gates while standardizing presentation.
- **Manage Music/Book slide-overs:** preserve the known Lidarr actions. Inventory
  the real Book panel only when an eligible library-linked Book is available;
  do not invent missing operations.
- **Users and user settings:** preserve navigation, identity/provider details,
  permissions, quotas, request history, notifications, and administration.
- **Application Settings:** inventory navigation, forms, service cards and
  modals, logs, jobs, and controls before redesign.
- **Profile settings:** preserve linked accounts, passwords, permissions,
  quotas, notifications, Plex portraits, and local-user upload behavior.
- **Login, setup, reset-password, and 404:** apply the shared theme without
  changing authentication or recovery behavior.
- **Other untouched or partially standardized pages/cards:** add them here when
  the full-site visual audit identifies them; auditing does not authorize their
  redesign.

## Start and completion gates

- John selects the item or explicitly begins a new batch before implementation.
- Refresh the exact upstream and fork commits before editing.
- Inventory existing behavior and identify representative data, permission,
  media, failure, and responsive states before redesigning a route.
- Preserve uncertain behavior for joint review instead of silently removing it.
- Add or update focused automated checks and the required release-note fragment
  for user-facing work.
- A visual task is complete only after source checks, a fresh build, and rendered
  desktop and narrow-layout verification of the changed states.
