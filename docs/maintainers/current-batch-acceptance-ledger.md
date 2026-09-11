# Current Batch Acceptance Ledger

This ledger preserves the user's individual instructions for the current SeerrNG batch. An instruction is not complete because related code or a release note exists. Every clause requires an implementation location, an automated check where practical, and a rendered-page check where the result is visual.

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

- Current gate: A laptop build is authorized after this audit is complete. After a fresh-build visual verification and a clean local GitHub-equivalent test suite, documentation and code publication to John Cronk's `JohnCronk79/seerrng` repository is authorized. The upstream `snapetech/seerrng` remote is never a publication target for this work.

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
- Rendered verification: Complete on fresh production builds for Movie, Series, Music, and Book request forms. The Music checks cover MP3-to-FLAC and FLAC-to-MP3. The Book check covers a complementary Ebook request plus a switch back to an active Audiobook request, which now shows Requested and disables submission.

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

- Implementation evidence: global canvas and mobile-menu CSS, shared refreshed card/inset surfaces, shared artwork scrim and horizontal gradient, and removal of vertical page fade.
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

- Implementation evidence: `MovieDetailsLayout.tsx`, shared expandable credit list, shared media-detail primitives, and shared placeholder asset.
- Rendered verification: Complete for the main artwork/details card, Overview, four-source rating row, action rows, three-column Cast/Crew disclosures, Subject Tags, Movie Details, recommendations, similar titles, and issue/request modals.

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

## Detail-page action buttons and history

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

- Implementation evidence: detail actions on all four media pages, global semantic button variants and sizes, separate normal and 4K Request actions on Movie and Series details, global rating-row geometry shared by Movie and Series, shared three-column credit list, and four-column Request Status history. Music and Book retain ordinary non-4K request actions because neither page has a 4K request choice to split.
- Current global rule: permission determines whether an action is hidden. A permitted action that is temporarily unavailable because of media or workflow state stays in its stable location, appears darkened with a prohibited cursor, and explains the blocking state in a tooltip. An action that genuinely does not exist for a title, such as a trailer when there is no trailer source, is not rendered as a false control.
- Rendered verification: Complete for shared button sizes, outlined semantic colors, white hover treatment, action order, Movie/Series rating geometry, three-person Cast/Crew rows, and Request Status four-column history. Fresh-build browser checks confirm separate adjacent Movie/Series normal and 4K actions, plus complete removal of the Movie 4K action for a user without 4K request permission. The unavailable Book representative visibly confirms the darkened prohibited-cursor state and reason tooltips used by the shared permission/state rule.

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
- Rendered verification: Complete for Discover root spacing/cards and live multi-word Movie, Series, and Music filters. Global `windows 11` search and Ebook filtering are relevant and field-limited. When Open Library was unavailable in the final production pass, Books discovery rendered the explicit provider timeout/error card instead of the incorrect `No results` state; route tests cover the relevant-result path when the provider responds.

## Music artist page

> “feature: when you look at a music artist details, the page needs a maor refresh including filters and sort order etc.”

- Status: Future feature, explicitly deferred by the user to the task list for another day. It is not part of the current build acceptance gate. Its detailed layout, filters, and sort choices will be designed with the user when that future feature is started.

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

## Final acceptance rule

> “now i want you to go over all of the prompts i have given you in the last few hours and verrify you actually did/will fix them. i can't test what you don't fix/change dear”

> “don't compress my instructions, ever. if you need to, ask me first.”

- Every item above must be classified as verified, corrected, intentionally deferred with the exact reason, or blocked by a named missing decision before the laptop build is presented as final.

- Rendered-audit correction: the first production visual pass found that the Blocklist action was hidden when a title was already available. The detail-page contract requires the action on Movie, Series, Music, and Book pages for users with Blocklist permission unless the title is already blocklisted. The four page implementations and validator now enforce that state-aware rule.
