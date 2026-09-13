# Current Batch Acceptance Ledger

This ledger preserves the user's individual instructions for the current SeerrNG batch. An instruction is not complete because related code or a release note exists. Every clause requires an implementation location, an automated check where practical, and a rendered-page check where the result is visual.

Recovery evidence rule (confirmed 2026-09-12): record intended, source-written,
automated, built, and render-verified states separately. The current laptop r3
image was created at 2026-09-12 04:18:02 MDT. It cannot provide build or rendered
evidence for source changed afterward, including the later SelectionCircle,
Collection Details, Series/Music selector, and global CSS corrections.

Task-capture rule: a message prefixed with `feature:`, `bug:`, or `issue:` is an instruction to preserve the complete item on the task list. The tag alone is not authorization to begin implementing it. Implementation begins only when the user later places that item into an active batch or explicitly asks for the work to start.

## Build and publication gates

> “ok dont build yet, you still need my explicit request.”

> “do not build yet, i'll tell you when. just making sure you follow that rule.”

> “dont write to github yet”

> “ok, finish this batch of fixes and build a new version for the laptop.”

> “build it”

> “if you get to the point of a working laptop build, i want you to do a full cleanup and github merge ok?”

> “i didnt mean merge the seer code, i meant merge our work progress and documentation.”

> “running the test suite and trying to fix any errors it find then re run the test again until it completes without errors. then at that point merge our code to our github repository.”

- Current gate: The replacement laptop build completed on 2026-09-13 and is awaiting the user's visual verification. After visual approval and a clean final local GitHub-equivalent test suite, documentation and code publication to John Cronk's `JohnCronk79/seerrng` repository is authorized. The upstream `snapetech/seerrng` remote is never a publication target for this work.

## Upstream conflicting features and integration decisions

The replay of the current work onto Keith's SeerrNG 3.20.1 base produced eleven
conflicted files. Those files belong to the following nine ordered feature
decisions. Treat this as the authoritative conflict task list. Do not replace it
with the separate deferred-page refresh list, and do not infer the next conflict
from an unrelated acceptance-ledger heading.

1. **Request Status filters and counts — decision complete; source and focused tests verified; fresh build/render pending.**
   Preserve Keith's `Incomplete` count as well as our `No Release Found` and
   `Failed` states. Display `No Release Found`, not `Unavailable`. Put all task
   filters in one wrapping row in this order: `Clear Filters`, `All Requests`,
   `Completed`, `Incomplete`, `Active`, `Needs Attention`, `No Release Found`,
   `Failed`. `Incomplete` includes its counter and sits immediately to the right
   of `Completed`.
2. **Books and Audiobooks discovery and request presentation — decision
   complete; recovery source and focused tests verified; fresh build/render
   pending.**
   Keep our refreshed Books discovery layout, live keyword filtering, relevance
   checks, advanced filters, sorting, activity indication, and provider-error
   presentation while retaining Keith's Book/Audiobook request-format context.
   The main page uses three format-filter buttons to the right of the title-view
   control: `All Books`, `Books`, and `Audiobooks`; `All Books` is the default.
   The unfiltered feed has no hidden Fiction restriction, initially returns 50
   broad random titles, and loads additional batches of 50 while scrolling.
   A successful but empty provider response to the default broad all-books feed
   is a provider failure, not a genuine `No results` response.
   Keyword searches default to newest matching releases first and load older
   matching releases in subsequent batches; an explicit user-selected sort
   overrides that default. A poster/title click opens Details without opening a
   request card and exposes every request type the user is permitted to use. A
   hover Request action opens Details and automatically opens the request card:
   `Books` preselects Book defaults, `Audiobooks` preselects Audiobook defaults,
   and `All Books` preselects Book defaults. The request card continues to expose
   all normally available service, quality-profile, metadata-profile, and
   root-folder choices; changing them in the card is authoritative. On success,
   close the card and remain on Details. Cancel also closes the card, clears the
   automatic-open state so refresh does not reopen it, and remains on Details.
   Browser Back returns to the preserved browse filter, search, sort, loaded
   results, and scroll position. Direct Details uses one segmented request
   control: `Request | Book | Audiobook` when both types are permitted, or the
   appropriate single-type form when only one is permitted. Hover brightens the
   hovered type and dims the other while retaining the standard white Request
   icon/text and border treatment. Permission-hidden types are not shown.
   State-disabled types remain visible, darkened, non-clickable, use the
   prohibited cursor, and explain the exact reason in a tooltip. If one type is
   already available and the other permitted type remains valid, the valid type
   is the active choice; the available type never becomes interactive. A type
   is disabled only when no distinct valid target remains across media/request
   type, service instance, quality profile, metadata profile, and root folder.
   For an existing pending approval matching that complete target, an admin or
   automatically approved actor may use Request to approve and continue the
   existing request rather than create a duplicate; preserve the original
   requester and record who fulfilled the approval before continuing the same
   timeline. A user who cannot automatically approve sees the matching pending
   option disabled with an explanatory tooltip. Requests already approved,
   searching, downloading, or importing are disabled for everyone; failed,
   declined, and cancelled requests may be requested again. Apply the same
   navigation, segmented-format, permission, availability, pending-request, and
   disabled-state model to Movie/Series `HD | 4K` and Music `MP3 | FLAC`.
   Request-card `Approval` shows the effective result: approved for an admin;
   otherwise approved or required according to the selected requester's
   applicable permission. The compact `Requested By` control is sized to its
   longest username without resizing between selections. Move Approval into the
   right details group and remove the duplicate approval text beside Advanced
   Options.
   Recovery status: the approved `All Books` state and placement, the
   poster-card Request handoff to Details, the one-time automatic request-card
   opening, preserved Back navigation, and empty-default-provider failure are
   now source-written with focused route/restoration tests and contract checks.
   Fresh build and rendered verification remain pending. Approval now appears
   only in the right details group, `Requested By` sizes itself to the longest
   available username, and all four request cards block both available and
   actively requested exact destinations. The compact segmented controls no
   longer prematurely disable alternate-target-capable users before the request
   card resolves the complete destination. Matching pending requests can now be
   promoted in their existing timeline by a manager or by any actor whose
   request for that media type and format is automatically approved. The
   original requester is preserved, the acting user is recorded as the
   fulfiller, the existing notification path remains tied to the original
   requester, and focused coverage verifies Movie, Series, Music, and Book
   without creating duplicate request rows.
3. **Bookshelf request tracking — decision complete; source and focused tests
   verified.**
   Our code persistently follows Bookshelf requests through search, download,
   import, manual intervention, failure, and completion. Keith added newer
   format-aware removal and reclassification protections. Retain our complete
   lifecycle and timeline tracking and layer Keith's safeguards into it. Match
   each target by title, Book/Audiobook type, service instance, quality profile,
   metadata profile, and root folder. A Book update must not mark an Audiobook
   request available, failed, removed, or complete, or vice versa. Removing or
   reclassifying one format changes only that format's service association; if
   the other remains, the title remains partially available. A failure or
   manual-intervention hold for one target does not block another. Reuse the
   matching pending request rather than creating a duplicate. Test both
   Book-to-Audiobook and Audiobook-to-Book directions, including removal and
   reclassification.
   Recovery status: separate Book and Audiobook scanner associations now have
   symmetric automated coverage. Single-format removal and both partial-failure
   directions are also covered, and a successful removal is persisted even when
   the other Bookshelf backend fails. Matching-pending-request reuse now shares
   the verified cross-media promotion path described in item 2.
4. **Sonarr, Radarr, Lidarr, and Bookshelf polling — decision complete; source
   and focused tests verified; no live-service exercise required.**
   The code merged without a textual conflict, but its behavior still requires
   a conceptual conflict review. Keep Keith's current service API clients and
   response handling as the foundation while preserving our queue-plus-history
   state engine, Picard/manual-import holds, cross-media independence, and full
   request target identity. Continue polling every configured instance when one
   fails. Only the matching media/request type, service instance, quality
   profile, metadata profile, and root folder may update a request. A failed
   target must not block another valid type or quality. Music remains Importing
   during its Picard hold and moves to Available after Lidarr confirms
   completion. Retain the distinct No Release Found and terminal Failed states.
   Validate multiple instances, a failed instance, cross-quality requests,
   manual-import holds, no-release searches, and final availability with
   automated tests. Do not exercise the live Arr services merely to resolve the
   integration.
   Recovery status: the per-instance polling loops retain isolated failure
   handling, and a focused multi-instance test now proves that a healthy server
   is still recorded when another configured instance fails. Existing focused
   tests cover cross-quality Music eligibility, Picard/manual-import holds,
   no-release handling, queue/history state, and final Lidarr availability. No
   live Arr or Bookshelf request was made during recovery.
5. **Media Details playback and media-server behavior — decision complete;
   source and focused tests verified; fresh build/render pending.**
   Restore playback as two distinct shared controls. `Play on <media server>`
   replaces the signed-in media-server user's one persistent playlist named
   `SeerrNG - Current Selection`, then opens that playlist in the configured
   Plex, Jellyfin, or Emby interface using that server's icon. Never accumulate
   multiple SeerrNG selection playlists. `Play on Device` is a dropdown of
   active, authorized, remotely controllable clients and submits a temporary
   ordered queue to the chosen device without saving a playlist. Both controls
   consume the same selection-circle state and use a black background with a
   gray border and text, changing to white on hover. Movie places both controls
   at the left of the ratings row. Series restores multi-selection controls for
   seasons and episodes; selecting a season selects every available episode in
   it, unavailable episodes remain visible but cannot be selected, an
   individual episode can be deselected to leave its season partially selected,
   and the playback order is normal season-and-episode order regardless of click
   order. Music applies the same behavior to album and track selection in
   original disc-and-track order. Audiobooks reuse the music
   interface but expose only independently playable tracks/files/parts reported
   by the media server, never embedded chapters; the track surface sizes to its
   content until its established maximum height and then scrolls. An empty
   selection means play every available item in canonical order; only a catalog
   with no playable items disables the actions with an explanatory tooltip. Add a
   neutral server-stack availability-column heading with one tooltip explaining
   that the green circled check means available and the red circled X means
   unavailable. Individual row icons have no tooltip and no hover change. Use
   the existing Plex, Jellyfin, and Emby assets; do not download duplicates.
   Music adds the aggregate MusicBrainz release-group rating to the same row,
   normalized to Lidarr's familiar ten-point value, linked to MusicBrainz, and
   omitted when unrated. Show its vote count in the rating tooltip.
   SeerrNG chooses the highest cataloged quality without adding a playback-format
   dropdown: 4K before standard video on Jellyfin/Emby where distinct items are
   available, and FLAC before MP3 for music on every supported server. Plex keeps
   its normal video item choice because Plex can own rendition selection within a
   logical item. Music scans retain separate MP3 and FLAC provider identifiers in
   four nullable Media columns, with the legacy generic IDs as compatibility
   fallback; audiobooks continue to use their generic provider item.
   Recovery status: Movie, Series, Music, Audiobook, and Collection selections
   feed both controls. The server validates and reorders media selections against
   the current catalog before playback. Collection members are explicitly ordered
   oldest-to-newest. Empty selection defaults to all available media. Provider
   replacement, canonical-order, empty-selection, format-classification,
   duplicate-format scanner, and OpenAPI admission tests pass; the client
   typecheck passes. Fresh build/render verification remains pending.
6. **Request Status interface — decision complete; source, focused tests, and
   contract checks verified; fresh build/render pending.**
   Our approved task filters, cards, controls, four-column history, button
   behavior, and terminology remain visually authoritative. Integrate Keith's
   newer `Incomplete` and `Needs Attention` data according to decision 1 without
   replacing our interface.
7. **Discovery logging — decision complete; source and focused tests verified.**
   Preserve Keith's selected Book/Audiobook request-format context and our
   keyword-search context in one structured diagnostic entry. Include the
   active `all`, `book`, or `audiobook` format, bounded keyword context, page,
   page size, sort, and active genre/filter context. Record provider failures
   and timeouts without credentials or full provider URLs. Do not duplicate the
   entry and do not allow logging to change discovery results. The Book route
   now emits this sanitized context from one error path, and focused provider
   failure and timeout tests verify the single-entry behavior. No live provider
   request was made during recovery.
8. **Plex login and session behavior — resolved in favor of Keith's newer equivalent implementation.**
   The isolated comparison confirmed that the popup can close correctly. Keep
   Keith's newer security/session implementation because it contains the same
   functional popup handoff. Do not change it without a reproducible failure.
9. **Packaging, security, release machinery, and Docker boundary — decision
   complete; source and focused security test verified; fresh build/Linux CI
   pending.**
   Keith's current infrastructure is authoritative. Apply our Windows-safe
   Docker/tooling correction narrowly on top. The shared formatter covers every
   tracked and newly created, non-ignored source file and ignores only paths
   deleted by the current change. Run portable tooling locally; tests that
   genuinely require POSIX permissions, ownership, or symlink semantics may be
   skipped on Windows only and remain mandatory in Linux CI. Preserve the
   Docker build-context exclusions for secrets and runtime state, including
   `.env`, private keys, `.npmrc`, `.git`, and live `config`. Verify that the
   portability layer does not change Linux or GitHub behavior.
   Recovery status: the root `.npmrc` is excluded from the Docker context and
   is no longer re-exposed by a later negation rule. The focused container
   security test now evaluates ordered ignore rules and fails if a later rule
   exposes `.npmrc`; that test and the expanded repository contract check pass.
   The replacement Docker image build passed after the image build was separated
   from repository-only validation inputs that are intentionally excluded from
   the secure Docker context. The focused container security checks enforce the
   `.npmrc` exclusion and the direct in-image translation and application-build
   sequence. The Linux CI boundary remains pending.

The next conflict discussion after item 2 is item 3, Bookshelf request tracking.
The Collection Details refresh remains a separate required pre-publication task;
it is not part of this ordered conflict list.

## Request forms

> “on the request page (all of them), have the background artwork be inside the main card and use as large of an image as available and fill the card with that image.”

> “use our estalish spacing standard and move the avaliable space colum to be next to the root folder colum.”

> “the root folder color will change width depending on content.”

> “the entire colum [with `(name) (default)`] can go.”

> “in the requeste by dropdown, the title text is not centered in the button, it looks like it's top justified. same with the music request page. check all the request pages.”

> “when you request a music albulm there is still a 'this request will be approved automatically' card at the top, please get rid of it.”

> “put the status text next to the advanced options button as the other pages do.”

> “if you request a 4k movie which already has a hd version in the library, then in the advanced options of tht request you can select the hd version. at this point seer should already know that this quality of movie is already in the library.”

> “the request screen should disable the request button and the text next to the advanced options button should be replaced with a avaliable badge.”

> “this should be the process that all 4 request pages (movies series music books) use. so you can't request an item that is already in the library.”

> “if one type fails you don't want it to stop you from requesting a different media type or different quality if you set that up.”

> “don't forget to track the metadata profile as well in that group of variables to track.”

> “make sure to test the other way as well. if a flac version is in the library, make sure you can still request the mp3 version”

- Implementation evidence: `RequestMediaCard.tsx`, `AdvancedRequester/index.tsx`, `RequestFooterStatus.tsx`, all four request modals, `requestAvailability.ts`, request admission and service-target persistence.
- Automated evidence: request availability, request route, service-target migration, and music-quality availability tests. The MP3-to-FLAC and FLAC-to-MP3 directions are separate test cases.
- Historical rendered evidence exists for earlier Movie, Series, Music, and Book request forms, including both Music quality directions and a complementary Book request. It does not verify the current post-r3 source. Recovery status: Approval placement, exact available/active destination protection in all four request cards, alternate-target-safe entry behavior, longest-username sizing, and matching pending-request promotion within the existing timeline are now source-written and contract/type checked. Focused route coverage verifies promotion for Movie, Series, Music, and Book while preserving the original requester and recording the approver. Fresh rendered verification remains pending.

## Report an Issue and issue pages

> “remove the movie series title from under the main page heading.”

> “edit the quality dropdown so it only uses the width needed to show it's contents, its too wide now.”

> “add a new 'issue type' dropdown with (other, audio, video, subtitle) with other being selected by default.”

> “remove the existing radio button choices as they are now no longer needed.”

> “this makes the whats wrong heading and the text input are as the only items in the card.”

> “format this card to be the same as the comment entry card in the issue details page.”

> “move the cancel and submit issue buttons to be below the test entry field and right justified and formatted with our style.”

> “put the above changes to the series report and issue form. the season and episode selector cards remain right under the details card.”

> “on the issues page, make the view issues button green.”

> “on the issue details page (all media), switch the close issue and exit button placements.”

> “on the issues page, inside the details card, it currently only shows the media type, but not the format.”

> “i want you to verrify that the quality drop down displays the currnet quality levels avaliable (hd and/or 4k etc) do this for all requests pages.”

> “Affected detail needs to show a summary that distinguishes non selected, season #, 2 or more seasons, and all seasons.”

> “on both of the movie and series report an issue form, the artwork is not contained within the full card.”

> “the issue type only has 1 entry, not the 4 which are required.”

> “move the issue type button to the end of the task filters row please.”

> “the issues page also defaults to the open issues task filter. please change this so all issues are shown as default.”

- Implementation evidence: issue form, artwork-backed issue summary card, unclipped compact selectors, issue list card, issue detail card, structured episode selection persistence, and affected-summary helper.
- Automated evidence: issue routes and migrations, exact four-option Movie/Series issue-type test, contract checks for card-contained artwork and unclipped dropdowns, media-format helper, and affected-summary helper.
- Rendered verification: Complete for Movie and Series report forms, Issue list, and Issue details. Both report forms contain artwork inside the summary card and expose the exact Other, Audio, Video, and Subtitle options in the compact selector.

## Request Status and Arr lifecycle behavior

> “when i request media as the test user, the request needs to be approved. however the request does not show up in the status page.”

> “all users should be the default setting for that button.”

> “feature: a refresh is needed in the request status page on a request waiting for approval and you click the edit button.”

> “while seer is waiting for picard, the timeline should be stopped at importing, not adding to library.”

> “the timeline should jump from importing (run picard) then to avaliable once lidar is done.”

> “if it is stuck on the timeline becuase of a failed search in lidar, we should get a status update so i can go into lidar and do an interactive search for it.”

> “do you think we should add these changes to the books status as well? ... the same can be said for all of the requests” — agreed scope: all supported Arr-backed request types, including manual-import holds.

> “i did a request for hold on in flac, it proceeded to lidar and downloaded the music with sab. now the complete file is wiating for picard to process it, but the stuat page now says the download failed. should it not be on importing while we wait for picard to do it's job?”

- Implementation evidence: Request Status default query, edit completion refresh, download tracker, Lidarr history/queue reconciliation, scanner and request-state helpers.
- Automated evidence: request-status query and lifecycle tests; Lidarr, Sonarr, subscriber, and download-tracker tests.
- Live end-to-end evidence already supplied by the user: Kenny Rogers moved automatically from the Picard hold to Available after Picard completed. The final production build renders real Importing/Picard-hold and Adding-to-library records correctly, and the full request-lifecycle suite covers the Hold On false-failure path. The next real Hold On-style download remains a useful operational confirmation, but it is not being simulated or forced while the user is away.

## Global background, artwork, and cards

> “on all of the pages of the site, can you make the background blue/purple gradiant more pronounced and stretched out?”

> “a progress of a light purple in the upper right going diagonally, to a current blue main color, then transition to a much darker blue in the bottom left corner.”

> “this effect can be applied to the menu slide out when viewing a narrow window.”

> “make all of the cards we have edited be a bit more translucent to see the background artwork a bit better.”

> “if yes, make the status page a bit more translucent, then apply that as our new standard to all the other cards on the site.”

> “lets make the site background have a forth color at the end, black.”

> “keep the bright first color more narrow in the gradiant as it should be a highlight color, not a main color, kinda like a spotlight at the top right of the page.”

> “put the last 3 color gradiants at a 40* angle”

> “yea i can see it now and it looks great. lets use it”

> “if [artwork-darkening] is the vissual fade on the bottom of the artwork i see on the odd page? if so, please get rid of that fade.”

> “there are still a fe buttons using that almost black background, please double check all the buttons to make sure they use our global css file.”

> “the clear filters and title view button should aways be the first items in the filter row.”

> “in music, series, and movies; the first filter row should be clear filters, title view, quality avaliable. then on the second row start with keyword search, then follow through with the rest of the buttons wrapping as needed.”

> “you can see the spacing between sort by and the buttons in the row above is larger then the spacing used in the other rows. i want to keep this larger spacing between filter types, apply this to all pages that use filters.”

> “the cards should be shaded that blue color not black.”

> “still showing grey text in the cards instead of the blueish color. this is on requests, blocklist and issues pages, but best to check all the cards to make sure the correct and same style is applied to the text”

> “can you make a validator that checks all code for inline or embedded css properties on the assets we have made/updated?”

> “when you select only a few episodes within a season, the season circle is blank. i think it should be green but make it a dark green to show a partial season, normal bright green to show a full sesaon.”

> “avaliable is green, processing is yellow, not avaliable is red. now make that change to all media details pages that uses those two quality avaliability items in the details card.”

- Implementation evidence: global canvas and mobile-menu CSS, shared translucent-blue refreshed card/inset surfaces, shared blue-lavender regular and muted card text, shared artwork scrim and horizontal gradient, and removal of vertical page fade. Request Status, Blocklist, Issues, media details, request cards, and every other refreshed consumer inherit the blue surfaces and content tones without a page-specific gray override. The fast refreshed-UI style validator is part of the normal current-batch gate and prevents inline/embedded visual styling, gray secondary card text, and nested near-black card surfaces from returning. Series selectors use one shared dark-green partial-season state and the established bright-green full state. Media detail availability values use the shared green/yellow/red semantic component across video, music, books, and collection members.
- Neutral filter, visibility, format, pagination, and slider controls consume the shared global blue control classes. Copied component-level near-black button recipes were removed from Global Search, Discover, Request Status, Blocklist, and Issues; intentionally black media-server playback controls retain their approved provider style.
- Discover filter ordering keeps Clear Filters first and Title View second; Streaming Services uses a generated Tailwind order value instead of falling back to the start of the row.
- Music, Movies, and Series share the same two-row contract: Clear Filters, Title View, and Quality Available occupy row one; Keyword Search begins row two and all remaining controls wrap naturally after it.
- Filter categories use the shared 20-pixel section gap across Search, discovery, Request Status, Issues, and Blocklist, matching the approved spacing before Sort By.
- Source verification: Complete. Rendered verification of the neutral-control standardization is pending the next intentionally requested laptop build.
- Rendered verification: Complete on desktop and narrow/mobile layouts, including the approved narrow upper-right highlight, 40-degree blue-to-dark-blue-to-black progression, mobile slide-out treatment, translucent cards, and removal of the old bottom artwork fade.

## Profile pictures and pagination

> “as plex is setup, and i'm logged in as a plex user, should the profile picture not be the same as used within plex?”

> “if plex is not setup, within the user profile you should be able to click an edit link to upload your own profile picture.”

> “on the blocklist page, the footer which holds the previous and next page buttons do not match the footer used in the issues page.”

> “make the issue page footer the standard we go by and update any page that uses a previous/next page button to use the same footer.”

- Implementation evidence: provider-owned avatar behavior, local-user upload route/UI, and shared `PaginationFooter` used by every paginated list.
- Automated evidence: local-avatar, avatar route, and avatar proxy tests.
- Rendered verification: Plex owner avatar and shared pagination footers are complete on the fresh production build. The local-user Edit control and upload route are source/automated verified; rendered upload remains explicitly unperformed because the authenticated browser is the Plex owner and no local-user credentials were assumed.

## Movie Details

> “first set the background art work to show inside the main card.”

> “get rid of the poster, media badge, status badge, title, movie rating, runtime genres.”

> “put in place out stndard details card here.”

> “create a card just like the comments card when viewing the issue details page.”

> “use the heading overview, then under it place the movie quote or whatever you call it.”

> “put this lind under the heading. then a blank line, then fill in the overview text.”

> “under that create a 6 colum table with divider lines and format it like the details card.”

> “populate it with the 6 details shown in the image and thier values (directors, screenplay, editor, producers, etc) and use their respecive values for each.”

> “without creating a card, have a new row which will show the 4 ratting images and their values as currently used.”

> “make the row the height of two text lines, make the image the full height of the row and have the text value vertically centered within the row.”

> “be sure to adequately space each pair (image and value) to each other as we have lots of width to work with here.”

> “have a row of buttons, the buttons will be the same style as the history button used in the status page.”

> “first drop down button called 'View Crew'.”

> “have that button fold out a new card with the headding 'full crew list' and under that, show 3 inset cards side by side.”

> “each card will show the profile picture of the person the full height of the card, to the right of the image, put their name and under it the job role they have.”

> “put their name in the same text style as the heading, then the job role in the same test style used in the action description of the history card.”

> “make the main card vertically scrollable and show 3 rows at a time.”

> “add a second button in the same row as the first called 'View Cast'.”

> “have that button open a new card exactly the same as the view crew card but populated with the cast of the movie, all other formatting stays the same.”

> “use the heading 'full cast list'.”

> “move the cast list button to the far left with the crew list button to it's right.”

> “make sure all cast and crew profile pictures link to thier respective details page.”

> “create a third dropdown button called 'subject tags' and have that fold out a new card with the heading 'subject tags'.”

> “place all of the movie tags inside this card and using our style of badge for each one in in random colors.”

> “make sure each badge links to the actual tag to show other movies with the same tag.”

> “create a new card with the heading 'movie details' then under it make 3 colums with dividers at the 1/3 width mark.”

> “each colum will be split into two colums, one for the detail name, the second for the value; just like we did in the details card.”

> “first colom, status - `<status>`, release dates - `<list the 3 release date each on a seperate row in the same colum with each other.`”

> “second colum, revenue - `<revenue>`, budget - `<budget>`, language - `<language>`, country - `<country>`.”

> “third colum, studios - ,`<tudio name>` only shoe the first 4 studios if more then 4 are linked.”

> “the studo names are links to the details of that studio. also link the country and language to their respective details page.”

> “close the main card at this point. then show the recomendations and posters under it as well the similar titles and it's posters under it as it is currently presented.”

> “remove the arrow in the circle icon from each heading and move the title view button closer to the heading by half the distance.”

> “without the corner border lines, use [Camera Shy] as the image to show when a profile picture is not avaliable.”

> “in our details page, add a card under the overview card with the heading of `<collection name>` then place a subcard below that with the artwork as the background.”

> “dim the background to 60% brightness level, then on mouse over make the brightness level 90% aand change the border to use 3 pixels and white.”

> “this is to make the subcard act as a button. have the subcad link to the view collection page.”

- Implementation evidence: `MovieDetailsLayout.tsx`, shared expandable credit list, shared media-detail primitives, and shared placeholder asset.
- Rendered verification: Complete for the previously approved elements. The newly integrated Collection card requires rendered verification in the combined preview before publication.

## Collection Details pre-publication refresh

> “add the view collection page to our task of things to refresh before we publish.”

- Status: Required before publication. This is not a deferred post-publication refresh.
- Inventory and preserve every existing Collection Details field, status, availability state, request action, blocklist action, link, and title card before redesigning the page.
- Apply the established detail-page styling and interaction standards only after the current upstream integration decisions are complete. Record any collection-specific element without a clear analogue for joint review rather than removing or guessing.
- Validate the refreshed Collection Details page with a real multi-film collection, responsive layouts, normal and 4K request permissions, partial availability, and blocklist states before publication.

### Approved Collection Details design

- Put the collection backdrop inside one main detail card and restore the
  contained poster exactly as on the refreshed Movie Details page. Use the
  collection name as the card title.
- Retain Genres and add `Collection Size: <number of items in collection>` as
  the first detail in the first column. Do not invent other collection details;
  leave the remaining positions blank until jointly designed.
- Use the standard action row. The left side contains Blocklist and
  Associations only; Manage, Report an Issue, and Watch Trailer are omitted.
  The right side uses the new shared dual-function normal/4K request control
  still being implemented in this batch, not the old request dropdown.
- The Associations action aggregates the associations of every movie in the
  collection. For example, a Spider-Man collection can therefore surface
  associated titles from the wider Marvel universe. Deduplicate the combined
  result.
- Add the standard Overview inset card beneath the action row, populated only
  with the collection overview. Do not include the director/writer/producer
  table.
- Beneath Overview, place the shared `Play on <media server>` and `Play on
  Device` controls, then the TMDB collection User Score. Link the score to the
  corresponding collection page on the TMDB website. The TMDB website exposes
  its collection User Score while the v3 collection payload exposes the member
  movie scores; reproduce the website's displayed collection score from those
  member values rather than labeling another provider's score as TMDB.
- Beneath that row, add the standard View Cast, View Crew, and Subject Tags
  disclosures. Aggregate and deduplicate those values from every collection
  member, loading the expanded data lazily so the initial collection page is not
  delayed.
- Add an Overview-style inset card headed `Collection`, without prose or a
  table. Inside it, show one reduced-scale standard details card per member.
  Preserve the same visible fields at narrower widths by reducing type with
  judgment; size each poster to the height of the five detail rows. Put a
  pronounced selection circle immediately before the item title. Show three
  item cards at once, scroll the remainder, and sort oldest to newest.
- With no manual selection, playback defaults to every available collection
  member in oldest-to-newest order. Once any member is manually selected, only
  the selected available members form the ordered playlist. Unavailable members
  remain visible but cannot be selected.
- In each collection-member details table, replace the `Media & Format` field
  with `Availability`. Its value is title-case `Available` in green or `Not
  Available` in yellow.
- In the collection request card, render the Status value yellow when ready to
  request and green when available.
- Recovery status: the legacy sliding-toggle table and embedded artwork styles
  have been removed. Collection requests now use one artwork-backed shared
  request card, the global SelectionCircle, oldest-first member ordering, and
  explicit Ready to Request, Requested, Available, and Blocklisted states. The
  Ready to Request value is yellow and Available is green. Focused state tests,
  the client typecheck, and the repository contract check pass; fresh rendered
  verification remains pending.

## Series Details

> “apply all the same formatting and cards as was made for the movie details page.”

> “some headings or detail descriptions may have to be renamed to follow the useage on the series page, but i'm sure you'll figure it out as the fields map almost exactly to the same physical place on the page as the movies page is.”

> “just under the details card, insert the 2 side by side cards used in the request series page that contains the season and episode selection cards. use this exact layout.”

> “remove the circle selection icon colums, as selecting a season of episode serves no purpose here. this is an information presentation only.”

> “Series currently provides Rotten Tomatoes critic/audience and TMDB ratings—there is no existing combined IMDb Series score to display. yes there is, see image from the reacher series detail page.”

> “if i remember correctly you told me that the imdb does not provide a rating for tv series. if it does and you can get the info, then yes add the image and value for the rating”

- Implementation evidence: `SeriesDetailsLayout.tsx`, `SeriesSeasonEpisodeBrowser.tsx`, and current series rating mappings.
- Source decision: the current application has only the movie-specific IMDb proxy. Sonarr's generic Series rating is not identified as IMDb and therefore must not be mislabeled. Series retains the screenshot's three dependable sources—Rotten Tomatoes critics, Rotten Tomatoes audience, and TMDB—until a trustworthy IMDb Series source is available.
- Status: IMDb Series ratings are explicitly deferred to a separate integration feature. The official real-time IMDb API requires a licensed data connection, the free personal-use source is a daily bulk dataset rather than a per-title API, and IMDb webpage scraping is not permitted.
- Rendered verification: Complete for the main artwork/details card, season/episode information layout, Overview, the three dependable rating sources with optically normalized artwork, action rows, three-column Cast/Crew disclosures, Subject Tags, Series Details, recommendations, similar titles, and issue/request modals.

## Music Details

> “add a issue button, update the request discography.”

> “apply the same layout and cards where applicable as the series detail page.”

> “remove the 2 cards that are side by side to show the season and episodes with the same two side by side cards used in the request music page.”

> “the albulm details page should have a quality avaliable badge to the left of the avaliable badge. so it'll show `<mp3>` and/or `<flac>` `<avaliable badge>`”

> “i think we can just get rid of the [artist overview] card as it's not being used.”

> “remove the total listens and total listners from the albulm details card.”

> “origin detail value should be linkable.”

- Implementation evidence: `MusicDetailsLayout.tsx`, `AlbumTrackList.tsx`, quality availability helpers, and music actions.
- Automated evidence: music availability and quality-availability tests.
- Rendered verification: Complete for artwork/details, MP3/FLAC availability badges, two-column tracks, stable action row, no unused artist-overview card, Album Details, linked Origin, and both cross-quality request directions.

## Books Details

> “update the books detail page on your own. buttons on the button row, cards used where they are applicable.”

> “rename subjects to genres, put them in their own card and add a genres button.”

> “each genres should link to other books that are tagged with the same genres.”

- Implementation evidence: `BookDetailsLayout.tsx` and book actions.
- Rendered verification: Complete for artwork/details, stable action row, Overview, linked Genres disclosure, Book Details, bibliography and format-specific request actions. State-disabled Manage and Report actions remain visible and expose their reason tooltips.

## Book terminology

> “rename every instance of 'Ebook' to 'Book' excluding the name of our services.”

- Every user-visible English label uses `Book` or `Books`, including format badges, request actions and guidance, Search and Request Status filters, settings labels, and the generated English language catalogue.
- Existing configured service names are preserved exactly. Internal compatibility identifiers such as `ebook`, API values, database fields, routes, and variable names remain unchanged.
- Superseding decision: the main Books page uses the three format controls `All Books`, `Books`, and `Audiobooks`, with `All Books` selected by default and the group placed to the right of the title-view control. This changes Keith's two-control behavior and placement while preserving the underlying Book/Audiobook format context.
- Implementation evidence: shared and page-level message definitions, `src/i18n/locale/en.json`, and user documentation now use Book terminology.
- Automated evidence: the current-batch validator scans all component presentation sources plus the shared and generated English language files, while allowing only configured service-name exceptions.

## Detail-page action buttons and history

> “there is supposed to be a poster in every detail card we've made, somehow it got dropped.”

> “restore the poster just like we had it.”

- Latest poster decision: every main Movie, Series, Music, and Book Details card retains its contained background artwork and also shows the title poster inside the standard details summary. The poster uses the same compact left column and fallback behavior as the other established details cards. This requirement supersedes the earlier Movie-specific instruction to remove the poster.
- The current-batch validator requires the shared poster test hook and responsive poster geometry in all four main detail layouts so a later refactor or upstream merge cannot silently remove it.

> “we had generes span into the next colum of details.”

> “keep the table layout the same, but you are spanning the rows over from where the genres value is now over until you reach the next values volume, the genres will then wrap to the next line if it's longer.”

- Latest Genres geometry: Movie, Series, Music, and Book Details keep Genres inside the existing details-and-values table. The Genres label remains in the first label column. Its value begins in the first value column, spans the remaining width of the first two detail groups, stops before the third status/format group, and wraps naturally onto another line when needed. Genres must not become a separate table, row outside the details table, or part of the third group.

> “on all media details pages, rename the button 'create issue' to 'report an issue' then move this button to the far left.”

> “move the blocklist button to the left of the report an issue button.”

> “make it the same red as we used on the posters on the main media pages.”

> “make sure all media details pages have these two buttons and place them as i said above.”

> “make the request discography button green, but a darker green then the request button.”

> “make the associations button the same blue/green/aqua color you used in the subject tags card.”

> “make the associations button on the main media pages match this color, make sure to apply our button styling to it.”

> “move this button next to the report an issue button.”

> “the size of the manage music button, remove the text and put the text in a tooltip, then make this button purple and move it next to the blocklist button.”

> “do the same on both movies and series detail pages.”

> “apply these styling choices to the music and books detail pages as well.”

> “the request in 4k button is larger then our stadard, please fix this and check the other buttons on all the details pages to they are all the same styling and size.”

> “remove the play on plex button.”

> “on the series detail page, move the watch trailer button next to the associations button and make it orange.”

> “the tmdb icon is way too big, make it and the popcorn image the same height as the tomato image. use the same size images on the movie details page.”

> “on the movies and series detail pages, in the crew and cast cards, i want you to have 3 person cards side by side”

> “the full cast card and the full crew list card both have a single subcard for each person per row. i told you i wanted there to be 3 person subcards on each row.”

> “make the watch trailer button orange and move it to the left of associations.”

> “rename the create issue button say 'report an issue' then remove the text and put it in ta toold tip.”

> “the buttons are also not using our standard styling. currently they have a solid background and white text.”

> “the button for reporting an issue is more orange then yellow”

> “the icon should go white on mouse over just like the buttons are supposed to do. watch trailer, associations and request buttons are all the same, no white text when mouse over.”

> “the request in 4k button is larger then our standard.”

> “if a button or layout on one page is different then the rest, there should be a documented excemption or you need to fix it. if in doubt you ask.”

> “the only condition any button is not shown is a permission state. so if a user does not have permission to use that button, it should be hidden, if however the permission allows it but the button cannot be used due to other factors (needs to have media avaliable), then the button should be greyed out (darkend) and the mouse over curser changed to the red circle with a diagnoal line”

> “on the condition the button is unable to be used, have a tooltip describe the reason why. make that a rule for all buttons on every page.”

> “the history card does not have it's colums setup correctly. put the date stamp in one colum, the time stamp in a second colum, the action of the history item, then a colum for the description of the history item. perform these changes to all history buttons”

> “on the movie detail page, the requet button is a drop down to select a 4k requst. can you change this so it's a normal button and move the request 4k button to the right of the normal request button.”

> “this button is permission based, so a user that is unable to request 4k media should not see the button.”

> “make that change on all details pages please”

- Implementation evidence: detail actions on all four media pages, global semantic button variants and sizes, the shared segmented `HD | 4K` Request control on Movie and Series details, the equivalent `MP3 | FLAC` and `Book | Audiobook` controls, global rating-row geometry shared by Movie and Series, shared three-column credit list, and four-column Request Status history.
- Current global rule: permission determines whether an action is hidden. A permitted action that is temporarily unavailable because of media or workflow state stays in its stable location, appears darkened with a prohibited cursor, and explains the blocking state in a tooltip. An action that genuinely does not exist for a title, such as a trailer when there is no trailer source, is not rendered as a false control.
- Rendered verification: Complete on the older r3 preview for shared button sizes, outlined semantic colors, white hover treatment, action order, Movie/Series rating geometry, three-person Cast/Crew rows, and Request Status four-column history. That older render showed the superseded separate Movie/Series request actions; the current segmented controls require a fresh build before visual approval. The unavailable Book representative remains historical evidence for the darkened prohibited-cursor state and reason tooltips used by the shared permission/state rule.

## Discover and keyword search

> “on the discover page, get rid of the circles with the arrow icon inside and move the view title button closer to the heading.”

> “remove the duplicate title view button as shown in the image.”

> “take note of the spacing between the request cards above and the trending heading, use this distance to separate each category as the standard space size.”

> “some are way too much of a vertical gap.”

> “apply our style to all badges and buttons on the page.”

> “make the genres section cards half as big. do the same the the studios cards and networks cards.”

> “the keyword search [on Books] is broken.”

> “once you figure out why and fix it, apply the same changes to the other keyword searches as i'm sure they will have the same issue.”

> “on the books page, we do not have the same server timeout error as we did in the main search when using the books filter. it's currently showing no results. please fix this”

> “on the status page, issues and blocklist pages the keyword search is interactive and searches live while you type. however the main movies series music and books pages do not have this ability. please fix that.”

> “if you look at the heading popular series and the spacing above it to the studio cards? well this spacing is to be used between each section of cards.”

> “you can see the difference with the popular series cards and the series genres heading. that difference is what you missed to fix.”

- Implementation evidence: Discover sliders and headings, compact category cards, keyword term normalization, debounced live filters, provider failure card, global search-activity reporting, and responsive slider height.
- Automated evidence: keyword search-term, provider route, discovery, and search-activity tests.
- Historical rendered evidence covers Discover root spacing/cards and live multi-word Movie, Series, and Music filters. Global `windows 11` search and Book filtering are relevant and field-limited. Recovery status: timeout/provider exceptions and a successful empty response to the default broad all-books feed now use the explicit provider-error path, with focused route and contract coverage. Fresh build and rendered verification remain pending.

## Music artist page

> “feature: when you look at a music artist details, the page needs a maor refresh including filters and sort order etc.”

- Status: Future feature, explicitly deferred by the user to the task list for another day. It is not part of the current build acceptance gate. Its detailed layout, filters, and sort choices will be designed with the user when that future feature is started.

## Series collections and franchise groups

> “TMDB provides a formal `belongs_to_collection` field for movies, but no equivalent for series.”

> “Our Associations system could eventually fill that gap—grouping spin-offs, sequels, prequels, and shared universes across series and even movies.”

> “agreed, put that as a feature: and add it to our task list.”

- Status: Future feature, explicitly deferred by the user. Do not implement it during the current upstream integration.
- Use the existing Associations system as the likely foundation for grouping related series, including spin-offs, prequels, sequels, and shared-universe titles. Preserve the possibility of cross-media relationships where appropriate.
- Before implementation, jointly decide how membership is sourced or curated, how a group is named and represented, where it appears on the Series Details page, and how it differs from recommendations, similar titles, networks, and ordinary associations.
- Do not infer or discard uncertain relationships automatically. Record ambiguous membership and presentation decisions for manual review.

## Collection request-page refresh and cross-media collections

> “feature: refresh request page from collection page for both movies and series. possibly build the same for music and books.”

- Status: Future feature, explicitly deferred by the user. Capturing this item does not authorize implementation during the current batch.
- Refresh the request flow opened from a Collection page for both Movie and Series collections. Preserve every existing permission, availability, normal/4K target, partial-collection, approval, service, quality-profile, root-folder, retry, cancel, and request-history behavior while applying the established request-card layout and interaction standards.
- Before implementation, inventory the exact route and request payload used for each collection entry point and verify whether Movie and Series collections are native provider collections, Seerr associations, or another grouping source. Do not silently treat unlike grouping types as equivalent.
- Evaluate an equivalent collection/group request experience for Music and Books. This portion is exploratory until the user reviews the available grouping metadata and approves exact behavior; do not invent album/discography, series/edition, Book/Audiobook, or cross-format semantics.
- For every supported media type, retain the global action rule: permission controls visibility; a permitted but state-invalid action stays visible and disabled with a prohibited cursor and an explanatory tooltip.
- Add validator coverage and rendered desktop/narrow-window checks when this feature becomes active, including mixed availability, already-requested items, partial collections, and users with different request and automatic-approval permissions.

## Deferred refresh of pages not yet redesigned

> “actually this is the perfect time for you to audit and document the pages and cards that we have not fixed yet so we have a solid list of tasks to do at a later time.”

> “once you are all done, my new plan is to have you use the pages and cards we have modified and use that plus our style rules and your validator to create context for you to inferr suggested design choices on those pages we have not touched yet.”

> “then when i view those pages we are not starting from zero, you would have already done a large portion of the refresh yourself.”

> “then we make a rule, that when you perform the refresh on you own that any field, detail, button, task, card that you are unsure about still gets saved and you make a note of it for us to both manually check out and determin what to do about it.”

> “please put the refresh of unknown pages in out task list so we do it later once we finalize what we did actually do. keep your notes above with that task so you know the rules to follow when you perform it.”

- Status: Future task, explicitly deferred until the currently changed pages have been audited, corrected, and finalized. Do not begin this redesign during the current acceptance pass.
- Derive proposed layouts from the approved pages and cards, `docs/maintainers/ui-style-standard.md`, and the contract validator rather than beginning each untouched page from zero.
- Reuse the established cards, controls, spacing, colors, translucency, artwork treatment, responsive behavior, and interaction patterns wherever their semantics match.
- Preserve every existing field, detail, button, task, card, link, and capability unless its replacement or removal is certain. Never silently delete, hide, repurpose, or discard an uncertain element.
- Record every uncertain element for joint manual review. Each note must name the page, element, current purpose, proposed treatment, why it is uncertain, and the decision still required.
- Clearly separate user-directed requirements from inferred design proposals in the task record and review presentation.
- Expand the validator as standards are applied so the inferred refresh remains consistent and future regressions are detectable.
- Visually inspect every refreshed page and relevant responsive state before presenting the future refresh for approval.
- Current known deferred areas include Manage Movies/Series, People, Artist, Author, Users, Settings, and any other page or card identified by the full-site visual audit as untouched or only partially standardized. The audit may add items, but it must not start their redesign during the present phase.

## Shared Blocklist confirmation

> “when a user preses that button, you dim everything shown on screen, then show a card in the middle of the screen with the website background gradiant.”

> “make the card twice as large as the movie genres posters on the discover page.”

> “put in bold text, \"are you sure you want to blocklist this item?\" then under it have a red cancel button and a green blocklist button.”

> “shold only contain the exact sentance and two buttons”

- Every add-to-Blocklist control, including the compact control on poster/title cards, opens one shared confirmation before the API mutation occurs.
- The page is dimmed behind a centered, responsive 18rem by at least 9rem card: twice the desktop compact Discover genre-card width and height, without overflowing a narrow viewport.
- The card uses the same four-color website gradient and contains only the exact bold centered sentence plus a centered standard red `Cancel` button and green `Blocklist` button. It does not contain the item title, media type, artwork, backdrop, or additional instructions.
- Removing an already-blocklisted item is a separate action and is not changed by this confirmation requirement.
- Implementation evidence: `BlocklistConfirmationModal`, the Movie/Series/Collection and Music/Book wrappers, `TitleCard`, and the shared global confirmation-card style.

## Final visual-correction batch before laptop preview

> “on the movies details page you can see the button for play on device is too big. also there needs to be a space between the plex logo and the text. make the logo as tall as the text in the button while maintaining aspect ratio.”

> “the spacing between the buttons and the ratings icon/value needs to be less as all 6 items should fit on one row.”

> “the background used for the collections button should be top justified, not centered vertically. the decline request button should be red, not green.”

> “make the button row full justified then the browser window can wrap and align the buttons so they are spaced evenly from each other.”

> “the genres heading and value should be on the 4th row in the first colum where collection size is the first row of the colum.”

> “the popup card to confirm the blocklist action should have the 'are' word capitalized, the buttons should be horizontally centered within the card and make the buttons the same style as our other buttons.”

> “the select all circle in the heading, same for the episode list.”

> “the track list tables need to be fixed just like the series table. and where is my ratings for the music details page?”

> “can you parse [a Markdown link] out automatically if that happens?”

> “move the results per page button to the far left, keep the page # of # centered, then on the far right have previous and next in that order.”

> “on the issue details page, put all the cards inside one large card that holds the background image.”

> “remove that card and just have the text entry field under the comments area.”

> “extend the width of the top main search bar so it's able to show the entire text string”

> “when you delete all the test, the default text string shows for a breif moment then the field populates with the text entry you deleted.”

> “apply all of these fixes to all pages that use these elements. these changes should be part of our standard and part of your validator.”

- Playback triggers use shared small sizing. Provider artwork is separated from the label, is one text-line high, and preserves aspect ratio. Movie and Series place two playback actions and four rating pairs in the same compact desktop row.
- Across Movie, Series, Music, Book/Audiobook, and Collection Details, the combined playback/rating row appears above the primary action-button row. When a selectable track, episode, or chapter list is present, the playback controls immediately follow that selector so the selected items lead directly to the actions that consume them.
- Plex playlist playback opens the Plex Web `playlist` route with the playlist container key (`/playlists/<id>`), derived by removing the terminal `/items` from the content key returned by Plex. A generic Details URL or passing the `/items` content key to Plex Web causes Missing details or Not found instead of opening the playlist.
- Shared detail disclosure controls such as View Artists, Subject Tags, View Cast/Crew, and Genres use the global blue control palette rather than a black surface. The refreshed UI validator reads the shared stylesheet and rejects a near-black disclosure rule or a rule that bypasses the shared palette variables.
- Detail action rows use one full-width wrapping `space-between` region. Semantic request approval and decline actions select green and red button roles from the shared request action model rather than inheriting the surrounding Request control color.
- Movie collection-link artwork is top-aligned. Collection Details keeps Collection Size in row one and Genres in row four of its first detail group.
- The shared Blocklist confirmation contains exactly `Are you sure you want to blocklist this item?`, a standard red Cancel action, and standard green Blocklist action, with the action row horizontally centered.
- Collection, Series, Music, Audiobook, Request Series, and Report Series selectors all consume the single shared `SelectionCircle` component and its global CSS contract. The inactive state is the established fixed dark gray-blue circle; the fully selected state uses the same circle with the established bright emerald fill and simple white solid check. A Series season row with only some episodes selected uses the same white check on a dark emerald fill. A partly selected list leaves its heading-level select-all circle inactive. Outlined green-check/red-X artwork is reserved for availability status and may never act as a selector. Collection does not define a separate partial variant. Both Series tables and every Music track table include a heading-level select-all control; descriptive columns align left and counts/availability align center.
- Music rating display uses MusicBrainz when present and falls back to the selected Lidarr album rating. Its source icon and safe source link share the global rating-row geometry.
- Book overview text safely renders provider Markdown links and normalizes the observed stray closing emphasis marker without enabling raw HTML.
- Every shared pagination footer places Results Per Page left, Page X of Y centered, and Previous then Next right.
- Issue Details contains every region inside one artwork-backed outer card, gives inset regions the same transparency, and places the comment textarea directly beneath Comments without another inset wrapper.
- The global search control uses a wider responsive maximum and clears both input and route query when backspaced to empty; a stale debounced route value may not reappear.
- Validator and focused regression coverage are required before the replacement laptop preview is built.
- Recovery status: the listed source corrections and their focused regression
  and repository-contract checks pass. Historical r3 renders remain evidence
  only for the pre-recovery source. The replacement laptop build completed on
  2026-09-13; its visual verification remains pending.

## Keith v3.20.2 upstream integration — 2026-09-13

- The recovered current-source layer was committed at `bc6b5d57` after the
  complete local suite passed: 2,023 tests, 1,985 passed, 0 failed, 38 skipped,
  and 0 cancelled in 46 minutes 30 seconds.
- Upstream `origin/main` at `843405fb` was selected for integration. It contains
  the complete v3.20.2 release at `59b223cc` plus the post-release English
  notification-catalog synchronization fix.
- The mixed-format Book status conflict combines the upstream incomplete-state
  correction with the current branch's separate Music import and no-release
  lifecycle. A both-format Book request remains Incomplete while either
  requested format is still unavailable; Music retains its dedicated stages.
- The Advanced Requester conflict retains the current selected-destination
  quality (`selectedIs4k`) while adding the upstream permission dependency, so
  eligible users refresh after media type, quality, or selected-server changes.
- The Request Status conflict retains the current task-button and compact-filter
  redesign. The obsolete single status dropdown is not restored; its duplicate
  Adding to Library option was already absent from the current interface.
- Automatic merge review confirmed that true Music/Book provider result totals
  were added without removing the current field-limited AND search behavior.
  The playback, selection, quality-variant, and global visual-style contracts
  were not replaced by upstream changes.
- Focused post-integration verification passed: 205 tests, 205 passed, 0 failed;
  server and client type checks; lint; i18n extraction/check; standalone format
  check; and the 357-file current-batch contract.
- Three image-packaging defects were exposed and corrected before cutover: the
  secure context excluded `.npmrc` while the Dockerfile still tried to copy it;
  the visual-audit contract file required during the image build was excluded;
  and repository-wide validation was being rerun inside a deliberately partial
  Docker context. Commits `9ef039ae`, `dbad2d3b`, and `2dd46d9a` correct those
  boundaries and add focused regression checks.
- Replacement image `seerrng:3.20.2-jc-preview-20260913-r1` built successfully
  from commit `2dd46d9a` and reports SeerrNG 3.20.2. It is running as
  `seerrng-laptop-preview-v3.20.2-20260913` on `127.0.0.1:5065`, using the
  existing preview configuration. Both the external readiness endpoint and the
  in-container health script passed.
- The previous r3 preview is preserved, stopped and unmodified, as
  `seerrng-laptop-preview-pre-3.20.2-20260913`. Keith's comparison container
  `seerrng-keith-v3.20.1-comparison` remains running unchanged on
  `127.0.0.1:5066`.
- For the user's visual comparison only, a transaction-safe copy of the laptop
  preview database was installed on the NAS SeerrNG 3.17.0 comparison service
  on 2026-09-13. Compatibility review found the server schema to be an exact
  subset; the only added migration supplies four nullable audio playback IDs.
  The copied database passed integrity and foreign-key checks and supplies 18
  blocklist entries, 7 issues, 13 comments, and 38 requests. The unchanged
  server image returned healthy with zero restarts. Its complete original
  database, WAL, and SHM rollback set is retained below the protected NAS
  `App-Development/SeerrNG/Database-Visual-Comparison-2026-09-13` backup path
  with a verified SHA-256 manifest. This visual-only server remains prohibited
  as source, implementation, or rendered-acceptance authority.
- The current-source visual inspection is the next gate. The complete suite is
  reserved for the post-visual, pre-publication checkpoint rather than repeated
  before visual review.

## Contextual Global Search filters

> “when you use the main search at the top of the page, you are presented with filters such as the title view, movie, series, books, music etc. you need to add a clear filters button the left of the current filter row.”

> “depending on media type filter you choose, the second row (wrapping to more rows as needed) will show the same filters beginning with the keyword search from each of the respective media pages. when all is selected, show the keyword search on the second row.”

> “make a new filter heading under the page title called 'media filters', then move teh all movies series books music buttons to that row. then in the filter row, have the clear filters, title view button, then keyword search and continue the row until it wraps.”

> “before i could search for madonna and then keyword search for an albulm she made, but that's not working anymore”

- A dedicated `Media Filters` heading contains the existing `All | Movies | Series | Books | Audiobooks | Music` controls.
- The following `Filters` row flows continuously as Clear Filters, title visibility, Keyword Search, and the selected media type's remaining discovery controls, wrapping naturally as space requires. All stops after Keyword Search. Movies and Series reuse their shared contextual filter panel; Books, Audiobooks, and Music preserve the filter order and provider behavior of their respective discovery pages.
- The main query remains exclusively owned by the fixed top search field. When it is populated, selecting a media type keeps the combined main-search provider source and passes that media type as a provider restriction; it does not replace the search with a broad discovery feed. Contextual Keyword Search starts empty and uses an independent result filter without replacing or duplicating the main query. Music sends both terms to MusicBrainz as an artist-or-album main query plus an album-title refinement so the filter can search the artist's full catalog rather than only the first already-loaded cards; while that refinement is active, the unrelated artist-card lookup is skipped so it cannot delay the album response past the provider deadline. The returned cards are still filtered locally as a final guard. The focused regression case is `Madonna` in the top search, Music selected, then `Prayer` in Keyword Search. Search progress temporarily occupies the existing clear margin above the page title, left-aligned with the search field, without changing the header width or reflowing the page on narrow screens.
- Changing media type preserves the main search query while clearing the secondary result filter plus incompatible contextual and Search sort state. Clear Filters likewise preserves the main query while removing the secondary result filter, media type, contextual filters, and Search sort state together.
- Status: implemented in source with client typecheck, lint, i18n, focused regression, and repository-contract checks passing. No further laptop build was started for these corrections; rendered acceptance remains part of the user's next one-build review gate.

## Series and Books discovery filter corrections

> “on the series page, move the status filter to the right of the keyword search.”

> “on the books and audio books pages, use the same idea of a media filter from the main search screen i just talked about. then the filters row will first show clear filters, titile view, keyword search, etc.”

> “on the series page, the genres dropdown is empty. it should be populated. the genres dropdown in the movies page works just fine”

- Series places Status immediately to the right of Keyword Search in both source order and rendered order. The shared Movie/Series genre selector preloads the appropriate type-specific TMDB list so its default dropdown is populated before optional text filtering.
- Books and Audiobooks place `All Books | Books | Audiobooks` beneath a dedicated `Media Filters` heading. Their regular Filters row flows as Clear Filters, title visibility, Keyword Search, First Published, Genres, Rating, and Language, wrapping naturally.
- Status: implemented in source; rendered acceptance remains part of the user's final one-build review gate.

## Workflow-page Media Filters sections

> “i want you to apply the media filter idea to the request, blocklist and issue page”

- Request Status, Blocklist, and Issues place their media-type buttons in a dedicated `Media Filters` section between Task Filters and regular Filters.
- Task Filters retain their workflow controls and existing Clear Filters placement. The regular Filters section retains Time Period and Keyword Search in one naturally wrapping row. Media choices and filtering behavior are unchanged; only their visual grouping changes.
- Request Status keeps distinct Books and Audiobooks choices because request records retain format. Blocklist and Issues keep one Books choice because their media records do not distinguish those formats.
- Status: implemented in source; rendered acceptance remains part of the user's final one-build review gate.

## Discovery availability and poster quality badges

> “how about we show `<checkmark>` hd then `<checkmark>` 4k? but keep the media type badge and association button on the first row were it was.”

> “hopefully you can do the same thing for series and music as well”

> “on the series page i tried to use the 4k quality filter and it shows no results when i know i have 4k episodes in my library”

> “whenever seer is gathering data from the arr apps, it should show tht it's searching and show the spinner. once that stops, then you know all the results are loaded.”

> “the whole purpose of the filter was to only show avaliable items on the server. no external website should be used for that as their results are not what we want.”

- Movie and Series posters keep the media-type and association badges on the first row and render ordered `HD` then `4K` status badges on a separate right-aligned second row. Music uses the same placement with ordered `MP3` then `FLAC` badges when exact scanned qualities are known. The shared poster inset remains unchanged across media types.
- Music MP3/FLAC and Movie/Series HD/4K discovery reads Seerr's synchronized local Arr catalog, including partially available video titles. Lidarr, Radarr, and Sonarr scans persist the card metadata required to filter, sort, and render those results without calling an external discovery provider merely to reconstruct items that Seerr already knows are present. Movie and Series cards use Seerr's local cover route; Music uses the stored MusicBrainz release-group identity for cover artwork.
- Quality-filter activity participates in the global search-progress indicator and remains active while the filtered availability search is still loading or scanning. A failed background page may not show the generic error toast when usable results have already loaded.
- RC7 source verification: the full focused discovery and Lidarr/Radarr/Sonarr scanner suite passes 138 of 138 tests; the discovery plus Radarr suite passes 104 of 104 tests after the final local-Movie assertion was added. Route tests independently prove that Music, Movie, and Series quality results come from the local catalog with zero external discovery calls. Server/client type checks, changed-file lint, formatting, and diff validation pass. RC7 laptop build and rendered acceptance remain pending.

## Deferred requested-Movie View Request refresh

> “feature: on a movie detail page for a movie that has been requested the view request page needs a refresh.”

- Status: Future feature, explicitly deferred by the user. Capture only; do not implement in the current correction batch.
- Inventory the exact requested-title entry point and every status, approval, retry, history, cancel, delete, service, format, permission, and return-navigation behavior before proposing its refreshed layout.

## Deferred media-detail action-row redesign

> “feature: edit the button rows on the media details page, the button alignment and spacing is just wrong especially when you factor in hidden buttons or buttons that only show up if you an admin.”

- Status: Future feature, explicitly deferred by the user. The currently approved full-width wrapping `space-between` correction remains in this build; the broader layout redesign is a later joint design task.
- The future work must test representative administrator, automatic-approval, ordinary requester, 4K-capable, unavailable-media, and missing-capability states on Movie, Series, Music, Book, and Collection details before replacing the current row.

## Final acceptance rule

> “now i want you to go over all of the prompts i have given you in the last few hours and verrify you actually did/will fix them. i can't test what you don't fix/change dear”

> “don't compress my instructions, ever. if you need to, ask me first.”

- Every item above must be classified as verified, corrected, intentionally deferred with the exact reason, or blocked by a named missing decision before the laptop build is presented as final.

### Recovery reconciliation classification — 2026-09-12

- Corrected and source/focused-check verified: all nine upstream conflict
  decisions within their active scope; request forms; Request Status and Arr
  lifecycle behavior; Collection Details and Collection request presentation;
  shared SelectionCircle/global styling; Books discovery and logging; the final
  visual-correction source batch; Docker `.npmrc` exclusion; and the stale
  focused test expectations identified during replay.
- Historical render evidence only: every visual claim from the r3 image created
  at 2026-09-12 04:18:02 MDT. No r3 render is treated as proof for source changed
  afterward.
- Explicitly deferred: Series IMDb integration; Music Artist refresh; Series
  collections; cross-media Collection request redesign; untouched-page
  redesigns; requested Movie View Request refresh; and the broader media-detail
  action-row redesign.
- Awaiting the user's existing gate: current-source visual inspection, the
  complete pre-publication validation suite, and GitHub publication. The fresh
  laptop build completed on 2026-09-13; visual inspection has not yet been
  recorded as approved.
- No active ledger item remains unclassified.

- Rendered-audit correction: the first production visual pass found that the Blocklist action was hidden when a title was already available. The detail-page contract requires the action on Movie, Series, Music, and Book pages for users with Blocklist permission unless the title is already blocklisted. The four page implementations and validator now enforce that state-aware rule.
