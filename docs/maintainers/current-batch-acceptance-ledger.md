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
- Media-type, format, availability, bell, and timer badges retain their
  established semantic colors while sharing the buttons' 35-percent resting
  background opacity. Interactive linked badges use the matching 55-percent
  hover opacity instead of becoming solid. When no quality badge is present and
  the existing no-request/no-media visibility rule permits Blocklist, its icon
  occupies the empty first-row right slot instead of a third poster row.

### Detail playback quality selection

> “the default quality selection will be hd/mp3 for all pages unless only the 4k/flac is available ... only the quality selected will be made into the playlist.”

- Status: Implemented in source with focused root-selection and playlist
  translation coverage. A fresh build and rendered Movie, Series, and Music
  verification remain pending under John's no-build gate.
- Movie, Series, and Music details anchor a `Select Quality` control to the
  true bottom right of the third compact details group. It uses the translucent
  green Detail Request button treatment with a leading adjustments icon, the
  selected quality, and a trailing chevron. Movie and Series offer HD and
  permitted 4K; Music offers MP3 and FLAC.
- HD or MP3 is the default whenever that lower quality is available or neither
  quality is available. The higher quality becomes the default only when 4K or
  FLAC is available and its lower-quality counterpart is not.
- Track and episode availability, selection, Play on Server, Play on Device,
  and the replacement playlist all follow the exact selected catalog. Legacy
  audio roots remain usable only when no exact MP3 or FLAC root has ever been
  recorded; an ambiguous root cannot substitute for a missing known variant.
- Music track rows use each selected Lidarr instance's recording-level file
  state, so a missing MP3 or FLAC track receives a red X while the files that
  instance actually has receive green checks. When Lidarr track data is
  unavailable, the media-server playback catalog remains the fallback.
- Music no longer repeats MP3, FLAC, and Available badges beneath the title.
  Its detail groups use equal thirds after the poster, its Genres value spans
  both metadata columns, the standalone Album heading card is removed, and the
  single selector in the left track-card heading selects every playable track
  across both cards.

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

## Pinned Cast, Crew, Artists, and Tags disclosures

> “feature: add a pin to the cast crew and tags button on the media details page.”

- Status: Implemented in source with database, API, optimistic-client,
  accessibility, and focused contract coverage. The earlier production build
  passed before the pushpin refinement; that icon change remains source-only
  until the next explicitly requested laptop build.
- Cast, Crew, View Artists, and Subject Tags each have an independent pin
  segment to the left of the disclosure label where that content exists. The
  control uses a conventional angled menu pushpin, not a map-location pin.
  Selected pins use a solid icon and `aria-pressed`; unselected pins use an
  outline icon and an explanatory tooltip.
- A pinned disclosure defaults open across Movie, Series, and Collection
  details. View Artists and Subject Tags carry into Music details, while the
  shared Subject Tags preference also controls the equivalent Genres
  disclosure on Book details. Selecting a pin opens its card immediately;
  clearing the pin collapses it immediately.
  The main button body can still open or close an unpinned card for the current
  page visit.
- Persist all four preferences on the existing per-user settings record and
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

### Background request interaction and independent qualities

> “the request process should be in the background and not prevent you from interact with the poster or requesting another media quality.”

- Status: Implemented in source with focused request-admission and current-batch
  coverage. A fresh build and rendered poster/request verification remain
  pending under John's no-build gate.
- MP3 and FLAC remain independent Lidarr destinations while either request is
  pending or processing. A zero-valued Lidarr service ID remains an explicit
  selection instead of falling back to the default service.
- Poster-local request loading is cleared before the request modal unmounts.
  Its visual spinner layer ignores pointer input, so transient or stale loading
  feedback cannot intercept the poster link or prevent opening media details.
- Automation-service dispatch remains asynchronous after request admission.
  The browser receives the saved request without waiting for the complete
  Radarr, Sonarr, Lidarr, or Bookshelf workflow, allowing another uncovered
  quality to be requested independently.
- Request errors show the server's safe returned explanation when available
  instead of always replacing it with the generic submission message.

### Playlist import card styling

> “on the music page when you click the import playlist button ... convert this to a card, use the site background, and apply our style to the card.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- The playlist import dialog is a centered, readable-width rounded and bordered
  site-background card with visible page spacing on every side, the standard
  shadow, and refreshed text colors.
- The playlist URL field uses the translucent request-control styling instead
  of the browser's solid white URL-input default.
- Cancel uses the red action style, Preview Matches uses the green action
  style, and Connect or Reconnect Spotify uses the cyan Associations style.
  Spotify and YouTube guidance uses the shared darker inset-card surface and
  divider treatment.

### Associations dialog styling

> “make the same layout and style as we used for the collection card ... get rid of the close X ... red Cancel ... green Browse More...”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- The item Associations popup now uses the translucent Collection-style main
  card and its results use bordered inset cards in a responsive two-column
  layout.
- The top-right close X is removed. A red Cancel action and green Browse More
  action appear at the bottom, with Browse More on the right.
- Browse More opens a full Associations explorer that reuses Discover's poster,
  shelf, heading, and spacing treatment instead of presenting a separate
  oversized visual system.

### Detail rating shadows and divider standard

> “try a subtle black shadow behind the ratings icons and value ... both vertical dividers should be the same 2 pixels wide ... only the horizontal lines used in the track/episode tables should also be 2 pixels wide and the darker blue color.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Rating icons, wordmarks, and values use a subtle black shadow for readability
  without adding a containing box.
- The two desktop vertical dividers in compact media details are exactly two
  pixels wide and use the shared dark-blue divider color. Mobile-only horizontal
  separators are suppressed when the desktop three-group layout is active.
- Track, chapter, season, and episode table header rules are two pixels wide and
  use that same shared dark-blue divider color.

### Report an Issue Collection-style card

> “the report an issue page should be formatted exactly like the collections details page ... all red and green cancel and (submit, continue etc.) buttons should follow this same size.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Report an Issue uses one large, clipped, artwork-backed outer card with the
  media summary, season and episode selectors, and description rendered as the
  same darker inset subcards used by Collection Details.
- Cancel and Submit Issue use the shared red and green buttons at the standard
  32-pixel action height. Shared modal actions now default to that same size so
  Continue and equivalent confirmation actions do not drift smaller or larger.

### Issue Details action row

> “change the exit button to a cancel button just to the left of the close issue button ... move the add comment button to the far left ... use our standard buttons.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Add Comment anchors the far-left edge of the action row before any media or
  automation-service links. Cancel and Close Issue or Reopen Issue remain
  adjacent at the right edge, with Cancel immediately to the left.
- The old Exit label and bespoke 22-pixel controls are removed. Every action in
  this row now uses the shared standard button component and default size.

### Request Status History action

> “the history button is not using the correct styling, and make the button green.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- History and Hide History use the same compact rounded button geometry as the
  neighboring request actions, with a translucent green surface, border, and
  text plus the standard brighter hover treatment.

### Edit request and destructive-confirmation cards

> “when you edit a request ... apply the same styling and layout to this card as the other cards ... the popup card ... delete or delete library should follow our standard styling.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Movie, Series, Music, and Book edit-request surfaces use a centered,
  artwork-backed refreshed main card with visible page spacing, the shared
  border and shadow, darker inset content, and standard-sized actions.
- Delete Request and Delete From Library confirmations use the site-background
  card surface, a darker inset explanation, and standard modal actions while
  preserving the existing destructive confirmation behavior.

### Discover controls and linked company filters

> “make sure [Discover controls] are the same styling and size as our standard buttons ... refresh orange ... forward and back green ... fix [the white Genres dropdown] ... studio title ... same filters ... high res color logo ... same treatment to networks.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Title visibility uses the standard small default/selected button treatment,
  Refresh is orange, and Previous and Next are green. All remain the standard
  32-pixel control size.
- Discover filter and sort controls retain the shared 32-pixel filter geometry.
  Selected React Select values now force the shared dark translucent surface,
  removing the legacy white Genre pill across Movie and Series filter links.
- Studio and Network buttons use TMDB's original-resolution PNG logo assets
  without the old duotone conversion. Their linked pages show the named Studio
  or Network title at top left, the same original logo centered above the
  filters, and the complete Movie or Series filter and sort toolset.

### Discover Recent Requests cleanup

> “under the recent requests heading ... do not show requests that have been deleted ... approve and decline buttons should be removed ... fix [the poster border] ... tighten up the card.”

- Status: Implemented in source with route and current-batch contract coverage.
  A fresh build and the broader Recent Requests row review remain pending under
  John's no-build gate.
- The Discover shelf uses its own recent-request filter, which excludes media
  in the deleted state. A request removed after a cached Discover snapshot was
  saved also disappears when its detail lookup returns not found.
- Approve and Decline remain available in the request-management workflow but
  are not rendered on the Discover shelf.
- Recent Request cards reduce their reserved height from 272 pixels to the
  artwork-and-content height. Poster frames are anchored to their artwork:
  square for Music and 2:3 for Movie, Series, and Book artwork.
- This is a bounded cleanup pass. Broader visual changes to the Recent Requests
  row are deliberately reserved for John's next build review.

### Book Details summary rhythm

> “the top portion ... which contains the details table does not look right ... fix this to match the other details pages ... get rid of the no playable tracks text.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- The Book summary now follows the same three primary metadata rows plus one
  Genres row used by the other detail headers. Publisher remains available in
  the lower Book Details card instead of duplicating a fifth summary row.
- An empty audiobook playback catalog no longer prints a standalone
  `No playable tracks are available` message. The disabled playback controls
  remain visible, and the selector still appears when playable audiobook tracks
  exist.

### Collection entries, linked text, and card scrollbars

> “collection card details cards should match the same layout and formatting as the request details card ... move the TMDB heading and value to the right column, then add the other ratings ... posters ... clickable ... scroll bar ... far right edge ... thin ... apply ... to all scrollable cards ... availability icon ... line up.”
>
> “in all details cards, any text that is clickable should have an underline.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered Collection, Series, Firefox, and narrow-layout review
  remain pending under John's no-build gate.
- Collection entries use the request-summary three-column rhythm: clickable
  poster, compact availability/release and linked Genre groups, then a ratings
  column. TMDB appears first, followed by lazily loaded Rotten Tomatoes critic,
  Rotten Tomatoes audience, and IMDb values.
- Every textual link inside media, request, issue, and collection detail cards
  has a visible resting underline that becomes heavier on hover. Standard
  button links retain their button presentation.
- Scrollable card regions use one shared thin scrollbar with a transparent
  track and stable gutter. Collection entries extend that region through the
  card's right padding so the scrollbar meets the inside right edge.
- Season, episode, track, people, association, request-selection, filter, theme,
  and status card scroll regions use the same scrollbar. Series season and
  episode lists extend through their right padding so row availability icons
  align with the header availability icon while the scrollbar remains at the
  card edge.

### Manage media Collection-style card

> “the manage series, movie, music buttons open a card on the side of the page ... use the create issue page as a guideline to reformat this card.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Manage Movie, Manage Series, and Manage Music now open as the same centered,
  artwork-backed outer card used by Report an Issue rather than as a narrow
  right-hand slide-over.
- Downloads, open issues, requests, blocklist, linked media services, playback
  statistics, quality-specific media, and advanced controls retain their
  existing behavior and render as darker inset subcards with the shared
  five-pixel spacing rhythm.
- The shared Book manager inherits the same layout because it uses the Music
  management component. A standard red Cancel action replaces the slide-over
  close control.

### Discover poster sizing

> “on the discover page, can you make the poster a bit larger ... the series silo has its media type truncated because of the limited width.”

- Status: Implemented in source with current-batch contract coverage. A fresh
  build and rendered review remain pending under John's no-build gate.
- Discover title posters retain the existing 2:3 ratio while increasing to 192
  pixels on smaller screens and 224 pixels at the desktop breakpoint.
- The poster shelf reserves 320 pixels on smaller screens and 360 pixels at the
  desktop breakpoint, with 12 pixels of vertical padding, so the complete card
  and border remain visible during the five-percent hover expansion.
- The larger width is scoped to Discover and includes loading placeholders, so
  library grids and detail-page recommendation shelves do not change size.

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
