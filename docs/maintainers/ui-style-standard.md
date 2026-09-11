# Seerr UI Style Standard

This document defines the shared visual and interaction rules for Seerr's refreshed user interface. New controls should reuse the shared components and classes described here instead of introducing page-specific variants.

## Scope

The standard applies to user-facing media discovery, detail, request, request-status, blocklist, and issue pages. Settings, Users, and the global search control in the application header retain their purpose-built layouts unless a separate change explicitly includes them.

## Compact Filter Controls

- Filter, sort, search, and paging controls use a compact 32-pixel control height, a one-pixel border, rounded corners, 12-pixel text, and the shared dark translucent background.
- Closed filter dropdowns size to their label and current value rather than using a shared fixed or minimum width. Keep them content-width and allow the opened option list to expand independently when an option needs more room.
- Composite controls place the title-cased label in a separate left segment and the selected value or input in the right segment.
- When a dropdown has a non-default value, only its label segment receives the active indigo highlight.
- Dropdown lists show no more than ten rows before scrolling and use compact row spacing.
- Rating dropdowns are the row-limit exception: they display `Any` plus every supported star threshold without a scrollbar. Their selected values and scored options show only the five-star visual, without a numeric score.
- The default display value is `Any` unless the control has a more meaningful neutral value.
- Search controls use the `Keyword Search` label and white, size-matched entered text.
- In page filter rows, Keyword Search uses a total width of 18 rems (`w-72`) when space permits and shrinks only when the available row is narrower.
- Multiple unquoted search words use implicit AND behavior. A user may type the word `AND`, but it is not required. Quoted phrases remain a single search term.
- Keyword Search results must contain every entered term in meaningful visible identity metadata. Movies and Series match title fields; Music matches album title, artist, and subject tags; Books match title, author, and Genres. Do not accept hidden provider-only fields such as a book publisher as the sole reason for a match, and do not replace provider relevance order with popularity ranking while a keyword query is active.
- Page-level Keyword Search controls report their debounce and results-loading activity through the shared `Searching` indicator beside the application header search. Keep that indicator in the header and do not add duplicate page-local spinners; it remains visible until every concurrent search source has finished.
- Reset controls use the shared `Clear Filters` label and selected or dimmed states. Selecting one clears the other filters for that page. Do not add duplicate `All Movies`, `All Series`, `All Music`, or `All Books` controls.
- The Movies filter row follows this fixed order: `Clear Filters`, title-visibility, `Keyword Search`, `Release Date`, `Genres`, `Content Rating`, `Studio`, `Runtime`, `TMDB Rating`, `Language`, and `Streaming Services`. Movies do not expose a `TMDB User Votes` filter.
- The Series filter row follows this fixed order: `Clear Filters`, title-visibility, `Status`, `Keyword Search`, `Release Date`, `Genres`, `Content Rating`, `Network`, `TMDB Rating`, `Language`, and `Streaming Services`. Series do not expose duplicate reset controls, `Runtime`, or `TMDB User Votes`.
- The Music filter row follows this fixed supported order: `Clear Filters`, title-visibility, `Keyword Search`, `Release Year`, `Release Type`, and `Genres`. Do not present provider relevance/popularity as a user rating. Add `Rating` or `Language` only after music discovery supplies reliable, filterable metadata for those fields.
- The Books filter row follows this fixed order: `Clear Filters`, title-visibility, `Keyword Search`, `First Published`, `Genres`, `Rating`, and `Language`.
- Discovery filter controls use the concise `Language` and `Release Date` labels for both Movies and Series.
- Time Period lists place `All Time` first and use it as the initial neutral value.
- Composite controls align vertically with adjacent buttons; flex rows must not stretch or top-align an individual dropdown or search control.

## Task and Regular Filter Rows

- `Task Filters` contains only workflow-state controls. `Clear Filters`, with the no-symbol icon, is always the far-left control in the first row; counted summary buttons follow it.
- Additional workflow-state controls occupy a second Task Filters row. On Request Status, this row contains the counted `No Release Found` and `Failed` exception buttons. Sequential lifecycle stages remain visible on each request card and are not duplicated in a page-level Timeline filter. Declined and Cancelled remain represented by the `Needs Attention` summary rather than separate filter buttons.
- Media type, Time Period, and Keyword Search are regular filters, not task filters. Requests, Issues, and Blocklist use the same media-filter button order and styling, followed by Time Period and Keyword Search on the next row. Media-level pages use one `Books` filter because those records do not distinguish ebook and audiobook requests; Request Status may show separate `Ebooks` and `Audiobooks` controls because its records retain the requested format.
- Page-specific regular filters precede the shared Time Period and Keyword Search controls on the second filter row. The Issues page uses a compact `Issue Type` dropdown with `Any`, `Audio`, `Video`, `Subtitle`, and `Other`; only the label segment receives the active highlight when a specific type is selected.
- Count bubbles show the number of records matching each task summary within the currently selected regular filters, without applying the selected task-state filter itself.
- Request managers open Request Status on `All Users` so approval-required requests submitted on another user's behalf remain visible. Selecting a specific user narrows the page explicitly; users without cross-user permission remain scoped to themselves.

Use `CompactSelect`, `CompactRatingSelect`, `getFilterResetButtonClass`, and `getFilterToggleButtonClass` from `src/components/Discover/FilterPanel/CompactFilterSelect.tsx` for these controls.

## Buttons

- Use the shared `Button` or `ButtonWithDropdown` components.
- Compact page actions use the small button size, consistent icon sizing, a one-pixel border, and the standard focus ring.
- Destructive or cancel actions use the red danger treatment.
- Successful submission or approval actions use the green success treatment.
- Warning or issue actions use the warning treatment.
- Neutral secondary and management actions use the default or ghost treatment.
- Tooltips explain icon-only buttons and use the shared tooltip component.

## Badges

- Media-type and status badges shown on the same row must have matching visual height, border thickness, and vertical alignment.
- Status or source badges rendered inside a compact detail row use the Issues-page compact badge as the standard: a 16-pixel outer height, 8-pixel text, one-pixel border, and four-pixel horizontal padding. They must fit within the row's normal line height and must not increase the card or poster-aligned detail height. Badges representing alternatives in the same field use the same component and exact dimensions; verify ascenders and descenders with glyphs such as `Y` and `y`. A 14-pixel internal line height may be used when required to preserve those glyphs without changing the outer height.
- Detail values that have a valid in-app destination remain clickable on every card using the shared details-and-values layout. This includes people such as directors, creators, artists, and authors; movie studios; series networks; and displayed genres or subjects. Use the standard indigo link color, underline on hover, and visible keyboard focus treatment. Plain facts without a destination, such as runtime, dates, counts, descriptions, and publishers, remain text.
- Badge icons and text are vertically centered.
- Media-type colors remain specific to the media type; status colors continue to communicate state.
- Larger badges may be used on detail pages, but they must preserve the same border, background-opacity, icon, and text treatment as their compact counterparts.

## Cards and Layout

- The application canvas uses one full-viewport four-color treatment. A narrow radial light-purple spotlight stays confined to the upper-right corner; beneath it, a 40-degree diagonal gradient moves through the primary blue, dark blue, and black at the lower-left edge. The light purple is a highlight rather than a dominant page color. Do not confine the treatment to a short header band. Apply the same treatment to narrow-window navigation slide-outs.
- Refreshed media cards use rounded corners, a one-pixel gray border, a 20-percent surface fill, and a subtle backdrop blur. Inset cards use a 30-percent dark surface. These shared translucency levels apply to Request Status, Issues, Blocklist, request forms, issue details, media details, and new cards built from this design.
- Full-card artwork uses a 60-percent base readability scrim plus the shared horizontal 30/48/76-percent dark gradient. Do not add a page-specific extra scrim; all artwork cards must retain comparable color visibility while keeping text readable.
- Full-page and modal artwork use one uniform readability scrim. Do not fade artwork vertically into a solid page color at its lower edge; page artwork should retain consistent color from top to bottom.
- Movie, Series, Music, and Book request artwork belongs inside the main request card rather than across the outer modal. Use the largest provider image available, make it fill the complete card with `object-cover`, clip it to the card boundary, and retain the shared dark overlay for readable content.
- Related detail columns use consistent gaps and aligned dividers. Avoid nested layout structures that create hidden or uneven spacing.
- Expandable cards open in the page flow without shifting the parent card sideways or extending beyond the reachable scroll area.
- Button rows use the same inset on the left, right, and bottom as the surrounding card.
- Use a five-pixel vertical gap between adjacent card regions, including the poster/detail region, timeline or expandable region, and footer action row. Do not add a second padding value that doubles this gap.
- Treat 720 CSS pixels as the desktop-card breakpoint so two side-by-side browser windows on a scaled FHD display retain side-by-side detail groups.
- Card detail groups size each heading track to that group's longest heading, then use the same three-quarter-rem gap between headings and values that appears between a vertical divider and the following group. The first media-detail value column remains six rems wide in the desktop-card layout so the one-third divider positions stay fixed; oversized values truncate instead of shifting the grid.
- Timeline scroll controls remain hidden while the complete timeline fits. Show them only when measured horizontal overflow actually clips part of the timeline.
- Issue detail pages begin with the same compact poster-and-details card used by request pages. The right detail group uses `Created By`, `Created On`, an unlabeled time row, and `Issue Type`, in that order.
- Report an Issue forms do not repeat the media title beneath the page heading. Movie and Series forms place content-width `Quality` and `Issue Type` dropdowns in the media-summary footer; `Issue Type` defaults to `Other` and replaces the former radio-button grid. Series forms keep the season-and-episode selector immediately below that summary.
- Movie and Series issue cards always show the saved target in `Media & Format` as `Movie · HD`, `Movie · 4K`, `Series · HD`, or `Series · 4K`. The Report an Issue `Quality` dropdown lists only the HD and/or 4K copies currently marked available, including partially available Series; never invent an HD fallback when no quality is available.
- Report an Issue description entry uses the same inset-card and three-row, vertically scrollable textarea treatment as the Issue Details comment entry. `What's Wrong?` and the textarea are the only normal contents of that card; validation feedback may appear when required. Compact red `Cancel` and green `Submit Issue` actions sit in a separate right-aligned row directly below it.
- Issue description, affected-episode, and comment regions use the Request Status history-card treatment and a five-pixel gap between adjacent cards.
- Series issues persist the selected quality and a structured list of every selected season and its selected episodes. The issue detail page reconstructs that list into `Season`, `Episode`, and `Title` columns with one vertical scrollbar after eight visible rows. Legacy single-season and single-episode issues remain readable through their original fields.
- Create Series Issue and Request Series reuse the same two adjacent selection cards after the media details card: a content-width season list with episode counts and a flexible episode list with episode number and title. Both heading rows own one select-all circle. A season selection may represent the entire season or a saved subset of episodes, multiple seasons retain independent episode subsets, and selected circles use the timeline's green fill and white checkmark.
- Exact series request selections persist with the request and are sent to Sonarr as episode monitoring plus an exact episode search. Omitting an episode list preserves the established whole-season request behavior.
- Description rows show the absolute date and time on one line with a visible separator space, followed by the description in the same row without reserved blank rows or vertical centering.
- Comment rows show the absolute date and time on one line with a visible separator space, followed by a dedicated avatar column spanning the visual height of the username and first comment line. The username occupies the first content row and the comment begins immediately below it with compact line spacing. Edit and delete actions remain top-aligned at the far right; only the first comment line reserves their width, while subsequent wrapped lines use the full content width. Comment entry uses a full-width three-row textarea inside an inset card and scrolls vertically beyond three rows.
- Issue action rows place media-server and automation-service links on the left. Exit, comment, and status actions appear on the right in that order, using red, yellow, and green treatments respectively. This keeps Close Issue or Reopen Issue at the far-right edge. The saved HD or 4K issue target controls which media and automation-service links open.
- Absolute audit timestamps show the date before the time. This applies to issue descriptions, issue comments, and Request Status history entries.
- Request cards show approval state beside `Advanced Options`: compact green `Approved Automatically` when the selected requester has the applicable auto-approval permission, or compact yellow `Approval Required` otherwise. This state and the submitted request status always follow the selected requester's permissions, even when an administrator acts on that user's behalf; do not use a separate alert card for this message.
- Request availability follows the currently selected destination quality or format, including changes made in Advanced Options. When that exact selection is already in the library, replace the approval-state text with the shared compact green `Available` badge and disable the request action. Enforce the same condition in request admission so a stale or manually submitted form cannot create the duplicate. A combined Ebook + Audiobook request remains eligible until both formats are available.
- Fresh Movie and Series request forms expose every configured destination quality the requester is permitted to use, regardless of whether the form was opened from a title card or a detail-page action. Selecting a destination refreshes its current quality profiles, root folders, languages, and tags. Music and Book request forms likewise populate service, metadata-profile, quality-profile, and format choices from the currently configured service rather than a static list.
- A details-page availability badge does not hide the request entry point when another configured destination may still be eligible. For albums, keep `Request` visible to permitted users unless the item is blocklisted; the request card determines availability from the selected Lidarr instance so an existing MP3 copy does not prevent a FLAC request, or vice versa.
- Album detail badges place one compact uppercase quality-profile badge for each available Lidarr destination immediately before the overall availability badge (for example, `MP3`, `FLAC`, then `Available`). Derive these labels from configured profile metadata and saved destination availability rather than inferring them from the album title.
- The permission-controlled `Requested By` control uses the same compact label and selected-value text sizing on Movie, Series, Music, and Book request cards. Its label, selected user, and chevron remain vertically centered within the fixed-height control; portal hosts use a flex container so inline baseline spacing cannot shift the control or its text upward.
- Advanced request root-folder tables use only two content-sized columns: `Root Folder` followed immediately by `Available Space`, separated by the standard three-quarter-rem detail gap. The root-folder column follows its longest visible path while remaining shrinkable in narrow layouts. Do not show a separate default-name or unlabeled metadata column.

### Media Detail Pages

- Movie Details establishes the shared detail-page structure for the later Series, Music, and Books refreshes. Put the largest available backdrop inside one clipped main card and fill it with `object-cover`; do not repeat the poster, media badge, status badge, giant hero title, or hero metadata strip.
- Begin the main card with the standard compact three-group details layout and keep its request, issue, blocklist, watchlist, associations, trailer where available, and management actions functional. Media-server playback is intentionally omitted from the refreshed detail pages.
- Movie Details follows the shared primary order of eligible Blocklist, icon-only Manage, icon-only Report an Issue, orange Watch Trailer, and Associations, with its green Request control at the far right. Its local-user watchlist utility remains in the secondary row. All controls use the shared compact treatment.
- The Overview inset card uses this order: heading, italic tagline or quote line, one blank-line gap, overview text, and six featured crew facts arranged as three divided detail groups. People names remain linked.
- Ratings sit in an unboxed row that is two compact text lines high. Each source icon fills the row height, its score is vertically centered, and each source pair has enough horizontal separation to remain visually distinct.
- The expandable control row uses compact history-style dropdown buttons in this order: `View Cast`, `View Crew`, `Subject Tags`. Cast and crew panels show three inset person cards per row and three rows within a vertically scrollable region. Each card uses the full card height for the profile image and links the whole card to the person page. Missing profile artwork uses the shared corner-free `camera-shy-profile-placeholder.png` asset.
- The history-style disclosure buttons are an intentional size exception to the 32-pixel primary action row: `View Cast`, `View Crew`, `Subject Tags`, `View Artists`, and `Genres` use the shared 22-pixel `DetailDisclosureButton`. They are panel toggles, not primary actions, and may not define page-local copies of this styling.
- Subject tags use compact, deterministic varied-color badges. Every badge links to movie discovery filtered by that subject tag.
- The `Movie Details` inset card uses three equal-width groups separated at the one-third marks. Group one contains Status and up to three stacked Release Dates; group two contains Revenue, Budget, linked Language, and linked Country; group three contains no more than four linked Studios.
- Recommendations and Similar Titles remain outside the main card. Their heading links omit the circular arrow, and the title-visibility control sits one compact gap from the heading.
- Series Details follows the same artwork-backed card, Overview, rating row, action rows, expandable Cast/Crew/Subject Tags, linked fact groups, and external Recommendations/Similar Series structure as Movie Details. Rename facts for series semantics: Creator, Network, Series Type, First/Last/Next Air Dates, and Episode Runtime.
- Series ratings use the three dependable sources shown by the established page: Rotten Tomatoes critics, Rotten Tomatoes audience, and TMDB. Do not label Sonarr's unidentified generic rating as IMDb. IMDb Series integration is deferred until a trustworthy licensed or bulk-dataset source is deliberately implemented.
- Directly below the Series compact details grid, reuse the two-card Series request selector proportions as a read-only season browser. The content-width left card lists Season and episode count; selecting a season only changes the flexible right card, which lists Episode and Title. Omit every select-all and item-selection circle because this view presents information and does not save a request selection.
- Music Details follows the same artwork-backed main card, compact three-group details grid, ordered action rows, expandable controls, final details card, and external related-title slider where music metadata has a reliable equivalent. Use Artist, Album Type, Track Count, MP3/FLAC destination availability, View Artists, Subject Tags, and Album Details terminology. Omit the unused Artist Overview panel and unreliable total-listen statistics; do not manufacture movie-style ratings or crew roles when the music providers do not supply them.
- Directly below the Music compact details grid, reuse the Request Music track-list presentation as a read-only two-card browser. Split the ordered track list evenly between the adjacent cards, retain `Track`, `Title`, and `Runtime` columns, cap the region at 214 pixels with one vertical scrollbar, and do not add selection controls.
- Music Details follows the shared primary action order, followed by its dark-green `Request Discography`, any active `View Request`, and the green quality-aware `Request` action. The local-user watchlist utility remains secondary. Do not add playback or trailer controls until the music model supplies a valid target.
- Books Details follows the same artwork-backed main card, compact three-group details grid, ordered action rows, Overview card, expandable control row, and final details card where Open Library supplies dependable values. Use Author, Publisher, First Published, Pages, Editions, ISBN, and separate Ebook/Audiobook availability terminology.
- Present Open Library subjects to users as `Genres`. Put the complete set in its own expandable Genres card, use the standard compact varied-color badges, and link every badge to Books discovery with that underlying Open Library subject selected. Do not leave a second always-visible Subjects badge region on the page.
- Books Details follows the shared primary action order, followed by its dark-green `Request Bibliography`, an active format-specific `View Request`, and green format-specific `Request Ebook` and `Request Audiobook` actions. The local-user watchlist utility remains secondary. Preserve the existing Open Issues region within the main card when issues exist. Do not add cast, crew, ratings, playback, trailer, or related-title rows without dependable provider data and valid action targets.
- Request Status History uses four explicit columns in this order: Date, Time, Action, Description. Never combine date and time in one stacked column or allow the action text to overlap either timestamp.

### Discover Page

- Discover category headings do not show the circular arrow-link icon. Keep exactly one title-visibility control, position it one compact gap from its heading, and remove duplicate visibility controls from the same category row.
- Use the vertical distance between the Request Cards region and the following Trending heading as the standard category-to-category gap throughout Discover. Do not allow individual sliders or category wrappers to introduce oversized blank regions.
- Every Discover badge and button uses the shared compact treatments from this standard; do not retain page-local oversized or legacy variants.
- Genre, Studio, and Network category cards use half the current legacy footprint while preserving readable labels, keyboard focus, and their complete clickable target.
- Keyword Search updates after a short typing pause on Movies, Series, Music, and Books; submitting the field remains a supported immediate action. The header search activity indicator stays active while the resulting provider request is loading.

### Media Detail Actions

- Movie, Series, Music, and Book detail action rows begin with eligible Blocklist, icon-only Manage, and icon-only Report an Issue controls in that order. Movie and Series insert their orange Watch Trailer control immediately before Associations. Media playback controls are omitted.
- Icon-only Manage and Report an Issue controls keep their labels in accessible tooltips and `aria-label` text. Blocklist uses the poster-card red treatment, Manage uses purple, Report an Issue uses a distinct true-yellow treatment, Associations uses the cyan/teal/blue subject-tag treatment, and bulk creator requests use a darker green than individual Request controls.
- All detail-page actions use the global semantic button classes and the same compact 32-pixel height, including both halves of split Request and Request in 4K controls. Colored icons and text turn white on hover. A page-specific deviation requires a documented exception.
- Movie and Series rating rows use the same global geometry: every rating image is 20 pixels high, each value is vertically centered beside its image, and every image/value pair shares the same 32-pixel row alignment.
- Colored detail-page actions use a translucent dark tint, colored border, and matching colored text. They do not use a solid bright background with white text.
- All detail actions use the shared small control dimensions. Request and Request in 4K dropdown triggers must not grow taller than neighboring controls.

## Pagination Footers

- Every paginated page uses the shared Issues-style `PaginationFooter`; do not recreate Previous/Next controls inside individual pages or table rows.
- The footer sits five spacing units below the final result region without a separate opaque table-footer surface. A compact Previous button anchors the left edge, `Results Per Page` and `Page X of Y` remain grouped in the center, and a compact Next button anchors the right edge.
- Previous and Next use the shared small button treatment with four-pixel chevrons. Disabled navigation uses the shared button disabled state.
- Pages may retain their supported page-size choices, but the selector height, segmented label treatment, typography, page-count text, and alignment remain identical everywhere.

## Accessibility and Behavior

- Interactive controls retain a visible keyboard focus ring.
- Profile pictures follow account ownership. Plex, Jellyfin, and Emby accounts use the picture supplied by that provider and do not expose a competing Seerr upload control. A signed-in local user sees a compact `Edit` control on their profile picture and may upload a JPEG, PNG, or WebP image up to 5 MB. Uploaded pictures are normalized to a square asset, stored in the persistent application data area, and versioned so replacements refresh immediately.
- Toggle and reset buttons expose their selected state through `aria-pressed` where applicable.
- Icon-only buttons require an accessible label and a descriptive tooltip.
- Permission-controlled actions are not rendered for users who cannot perform them.
- A provider failure must display the provider-specific recovery message. Cached results may remain visible, but a generic success or zero-results state must not hide the outage.
- Short empty-state and status labels do not end in sentence punctuation (for example, `No Comments`, `No Results`, and `No Tracks Available`). Full explanatory or error sentences retain normal punctuation.

## Review Checklist

When changing a shared control or badge, verify every in-scope page that uses the same element. Confirm default, active, hover, focus, disabled, open, narrow-window, and error states before accepting the visual change.
