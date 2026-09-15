/* eslint-disable @typescript-eslint/no-require-imports -- This validator is loaded by the repository's CommonJS contract runner. */
const fs = require('node:fs');
const path = require('node:path');

const readRepositoryFiles = (root, fileNames) =>
  Object.fromEntries(
    fileNames.map((fileName) => [
      fileName,
      fs.readFileSync(path.join(root, fileName), 'utf8'),
    ])
  );

const validateCurrentBatchContract = (files) => {
  const errors = [];
  const requireFile = (fileName) => {
    if (!(fileName in files)) {
      errors.push(`Missing contract input: ${fileName}`);
      return '';
    }
    return files[fileName];
  };
  const requireText = (fileName, text, reason) => {
    if (!requireFile(fileName).includes(text)) {
      errors.push(`${fileName}: ${reason}`);
    }
  };
  const rejectText = (fileName, text, reason) => {
    if (requireFile(fileName).includes(text)) {
      errors.push(`${fileName}: ${reason}`);
    }
  };
  const requireCount = (fileName, text, expected, reason) => {
    const source = requireFile(fileName);
    const actual = source.split(text).length - 1;
    if (actual !== expected) {
      errors.push(
        `${fileName}: ${reason} (expected ${expected}, found ${actual})`
      );
    }
  };
  const requireOrder = (fileName, tokens, reason) => {
    const source = requireFile(fileName);
    let previous = -1;
    for (const token of tokens) {
      const position = source.indexOf(token, previous + 1);
      if (position < 0 || position < previous) {
        errors.push(`${fileName}: ${reason}`);
        return;
      }
      previous = position;
    }
  };

  const ledger = 'docs/maintainers/current-batch-acceptance-ledger.md';
  requireText(
    ledger,
    'Task-capture rule: a message prefixed with `task:`, `feature:`, `bug:`, or',
    'must preserve the tagged-prompt capture rule'
  );
  requireText(
    ledger,
    'Completed work belongs in Git history and release notes, not',
    'must remain an outstanding-work-only ledger'
  );
  requireText(
    ledger,
    '## Hardcover-enriched Book search',
    'must retain the future Hardcover Book-search integration'
  );
  requireText(
    '.dockerignore',
    '.npmrc',
    'the Docker context must exclude the root npm credential file'
  );
  rejectText(
    '.dockerignore',
    '!/.npmrc',
    'the Docker context must not re-include the root npm credential file'
  );
  requireText(
    '.dockerignore',
    '!docs/maintainers/site-visual-audit-2026-09-11.md',
    'the Docker context must include the visual audit required by the prebuild contract'
  );
  requireText(
    'scripts/check-container-security.test.mjs',
    'a later negation re-exposes the root .npmrc',
    'the container security test must evaluate later npmrc negation rules'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'use the shared 22-pixel `DetailDisclosureButton`',
    'must document the intentional disclosure-button size exception'
  );
  requireText(
    ledger,
    "Sonarr's generic Series rating is not identified as IMDb",
    'must preserve the evidence-based Series IMDb decision'
  );
  requireText(
    ledger,
    '## Music artist page refresh',
    'must keep the music artist refresh deferred'
  );
  requireText(
    ledger,
    '## Pinned Cast, Crew, and Tags disclosures',
    'must retain the pinned media-detail disclosure feature'
  );
  requireText(
    ledger,
    '## Series collections and franchise groups',
    'must retain the future Series collections feature'
  );
  requireText(
    ledger,
    '## Deferred requested-Movie View Request refresh',
    'must retain the tagged View Request refresh as a deferred feature'
  );
  requireText(
    ledger,
    '## Deferred media-detail action-row redesign',
    'must retain the tagged action-row redesign as a deferred feature'
  );
  requireText(
    ledger,
    '## Collection request-page refresh and cross-media collections',
    'must retain the future cross-media Collection request work'
  );
  requireText(
    ledger,
    '## Deferred refresh of pages not yet redesigned',
    'must retain the deferred-page refresh inventory'
  );
  requireText(
    ledger,
    '## Keith-requested feature',
    'must retain the pending Keith feature intake'
  );
  requireText(
    ledger,
    '## New v3.21.2 corrections',
    'must retain the pending v3.21.2 correction intake'
  );
  requireText(
    ledger,
    '### Poster overlay alignment',
    'must retain the poster overlay alignment task'
  );
  requireText(
    ledger,
    '### Poster overlay shadows',
    'must retain the poster overlay shadow task'
  );
  requireText(
    ledger,
    '### Main-menu cleanup',
    'must retain the main-menu cleanup task'
  );
  for (const navigationFile of [
    'src/components/Layout/Sidebar/index.tsx',
    'src/components/Layout/MobileMenu/index.tsx',
  ]) {
    requireCount(
      navigationFile,
      "href: '/discover/audiobooks'",
      1,
      'primary navigation must contain exactly one Audiobooks entry'
    );
    requireCount(
      navigationFile,
      "href: '/requests'",
      1,
      'primary navigation must retain exactly one main Requests entry'
    );
    rejectText(
      navigationFile,
      "href: '/requests/status'",
      'primary navigation must not contain the removed Request Status entry'
    );
  }
  requireText(
    'src/styles/globals.css',
    'background-color: transparent !important;',
    'compact discovery selectors must override the white third-party control surface'
  );
  for (const [fileName, tokens] of [
    ['src/components/Discover/FilterPanel/index.tsx', ['sortBy: undefined,']],
    [
      'src/components/Discover/DiscoverBooks/index.tsx',
      ["sortBy !== 'ranked'", 'sortBy: undefined,'],
    ],
    [
      'src/components/Discover/DiscoverMusic/index.tsx',
      ["sortBy !== 'ranked'", 'sortBy: undefined,'],
    ],
    [
      'src/components/Blocklist/index.tsx',
      ["setSort('date');", "setSortDirection('desc');"],
    ],
    [
      'src/components/IssueList/index.tsx',
      ["setSort('added');", "setDirection('desc');"],
    ],
    [
      'src/components/RequestStatus/index.tsx',
      ["setSort('added');", "setSortDirection('desc');"],
    ],
    [
      'src/components/Search/index.tsx',
      ['query: { query: query || undefined }'],
    ],
  ]) {
    for (const token of tokens) {
      requireText(
        fileName,
        token,
        'Clear Filters must restore the default sort order on every filtered page'
      );
    }
  }
  rejectText(
    ledger,
    '## Keith v3.20.2 upstream integration',
    'must not list completed release integration work'
  );
  rejectText(
    ledger,
    '## Final visual-correction batch before laptop preview',
    'must not list completed visual-correction work'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'Request Status uses one wrapping Task Filters row in this exact order',
    'the style standard must preserve the single wrapping Request Status task row'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'separate media type into a dedicated `Media Filters` section',
    'the style standard must preserve workflow-page Media Filters sections'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'On Books, `All Books` is not a reset control',
    'the style standard must keep All Books distinct from Clear Filters'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'Request cards show approval state in the right details group',
    'the style standard must keep Approval in the right request-details group'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'Remove duplicate approval text beside `Advanced Options`',
    'the style standard must reject duplicate Approval beside Advanced Options'
  );
  requireText(
    'docs/maintainers/site-visual-audit-2026-09-11.md',
    'every rendered claim in this document is\nhistorical evidence from the laptop r3 image created at 2026-09-12 04:18:02 MDT',
    'the historical visual audit must not claim current render evidence for post-r3 source'
  );

  requireOrder(
    'src/components/RequestStatus/index.tsx',
    [
      "key: 'all'",
      "key: 'completed'",
      "key: 'incomplete'",
      "key: 'active'",
      "key: 'attention'",
      "key: 'unavailable'",
      "key: 'failed'",
    ],
    'Request Status task summaries must retain the approved single-row order'
  );
  for (const fileName of [
    'src/components/RequestModal/MovieRequestModal.tsx',
    'src/components/RequestModal/TvRequestModal.tsx',
    'src/components/RequestModal/MusicRequestModal.tsx',
    'src/components/RequestModal/BookRequestModal.tsx',
  ]) {
    requireOrder(
      fileName,
      ['{intl.formatMessage(messages.approval)}:', '<RequestFooterStatus'],
      'request forms must render Approval in their details grid'
    );
  }
  rejectText(
    'src/components/RequestModal/AdvancedRequester/index.tsx',
    'RequestFooterStatus',
    'Advanced Options must not render a duplicate Approval status'
  );
  requireText(
    'server/entity/MediaRequest.ts',
    'findPromotablePendingRequest',
    'request admission must identify a matching promotable pending request'
  );
  requireText(
    'server/entity/MediaRequest.ts',
    'currentRequest.modifiedBy = actor;',
    'pending-request promotion must record the acting approver'
  );
  requireText(
    'server/routes/request.test.ts',
    'promotes matching pending Movie, Series, Music, and Book requests without replacing their requester or timeline',
    'matching-pending promotion must retain cross-media route coverage'
  );
  for (const fileName of [
    'src/components/RequestModal/MovieRequestModal.tsx',
    'src/components/RequestModal/TvRequestModal.tsx',
    'src/components/RequestModal/MusicRequestModal.tsx',
    'src/components/RequestModal/BookRequestModal.tsx',
  ]) {
    requireText(
      fileName,
      'canPromotePendingDestinationRequests',
      'request forms must permit authorized matching-pending promotion'
    );
  }

  const blocklistConfirmation =
    'src/components/BlocklistConfirmationModal/index.tsx';
  requireText(
    blocklistConfirmation,
    "confirmation: 'Are you sure you want to blocklist this item?'",
    'shared Blocklist confirmation must use the exact approved sentence'
  );
  requireText(
    blocklistConfirmation,
    'dialogClass="app-blocklist-confirmation-card"',
    'shared Blocklist confirmation must use the website-gradient card'
  );
  requireText(
    blocklistConfirmation,
    'cancelButtonType="danger"',
    'shared Blocklist confirmation must use the standard red Cancel button'
  );
  requireText(
    blocklistConfirmation,
    'okButtonType="success"',
    'shared Blocklist confirmation must use the standard green Blocklist button'
  );
  requireText(
    blocklistConfirmation,
    'actionsClass="!justify-center gap-3"',
    'shared Blocklist confirmation buttons must be horizontally centered'
  );
  requireText(
    blocklistConfirmation,
    'actionButtonSize="sm"',
    'shared Blocklist confirmation buttons must use standard small sizing'
  );
  for (const fileName of [
    'src/components/BlocklistModal/index.tsx',
    'src/components/ExternalBlocklistModal/index.tsx',
    'src/components/TitleCard/index.tsx',
  ]) {
    requireText(
      fileName,
      'BlocklistConfirmationModal',
      'every Blocklist entry path must use the shared confirmation'
    );
  }
  rejectText(
    'src/components/TitleCard/index.tsx',
    'onClick={() => void onClickHideItemBtn()}',
    'poster/title cards must not mutate the Blocklist before confirmation'
  );

  const visibleTerminologyFiles = Object.keys(files).filter(
    (fileName) =>
      (fileName.startsWith('src/components/') ||
        fileName === 'src/i18n/globalMessages.ts' ||
        fileName === 'src/i18n/locale/en.json') &&
      fileName !== 'src/components/RequestModal/AdvancedRequester/index.tsx'
  );
  for (const fileName of visibleTerminologyFiles) {
    const sourceWithoutServiceNames = requireFile(fileName).replaceAll(
      'Bookshelf-Ebook',
      ''
    );
    if (/\bEbooks?\b/.test(sourceWithoutServiceNames)) {
      errors.push(
        `${fileName}: user-visible Ebook terminology must be Book; configured service names are the only exception`
      );
    }
  }
  requireText(
    'src/i18n/globalMessages.ts',
    "ebookAndAudiobook: 'Book + Audiobook'",
    'shared format labels must use Book terminology'
  );
  requireText(
    'src/components/Search/index.tsx',
    "ebooks: 'Books'",
    'Search must label the ebook-format filter as Books'
  );
  requireOrder(
    'src/components/Search/index.tsx',
    [
      'intl.formatMessage(messages.mediaFilters)',
      '{searchCategories.map',
      'intl.formatMessage(messages.filter)',
      'getFilterResetButtonClass(!hasActiveFilters)',
      '<CardTextVisibilityToggle',
      '<ContextualSearchFilters',
    ],
    'Global Search must separate Media Filters from the continuous regular filter row'
  );
  requireText(
    'src/components/Search/ContextualSearchFilters.tsx',
    '<div className="contents">',
    'Global Search contextual controls must participate in the wrapping regular filter row'
  );
  requireText(
    'src/components/Search/ContextualSearchFilters.tsx',
    "category === 'all'",
    'Global Search All must retain its keyword-only contextual row'
  );
  requireOrder(
    'src/components/Search/ContextualSearchFilters.tsx',
    [
      'messages.keywordSearch',
      'messages.firstPublished',
      'messages.genres',
      'messages.rating',
      'messages.language',
    ],
    'Book and Audiobook Search filters must preserve their discovery-page order'
  );
  requireOrder(
    'src/components/Search/ContextualSearchFilters.tsx',
    [
      'messages.keywordSearch',
      'messages.releaseYear',
      'messages.releaseType',
      'messages.genres',
    ],
    'Music Search filters must preserve their discovery-page order'
  );
  requireText(
    'src/components/Discover/FilterPanel/index.tsx',
    "variant?: 'discover' | 'search';",
    'Movie and Series filters must support the shared contextual Search layout'
  );
  requireText(
    'src/components/Search/ContextualSearchFilters.tsx',
    'variant="search"',
    'Global Search must use the shared Movie and Series contextual filter layout'
  );
  requireText(
    'src/components/Search/searchFilters.ts',
    "return '/api/v1/search';",
    'Global Search All must keep the combined provider search source'
  );
  requireText(
    'src/components/Search/searchFilters.ts',
    "return '/api/v1/discover/music';",
    'typed Global Search filters without a main query must use the corresponding discovery source'
  );
  requireText(
    'src/components/Search/searchFilters.ts',
    'if (mainQuery.trim())',
    'a populated main search must retain the combined provider search source'
  );
  requireText(
    'src/components/Search/searchFilters.test.ts',
    'preserves the main query but removes stale contextual and sort state when media type changes',
    'Global Search media-type transitions must retain regression coverage'
  );
  requireText(
    'src/components/Search/searchFilters.test.ts',
    'does not pre-populate the result filter from the main search query',
    'Global Search Keyword Search must remain independent from the main query'
  );
  requireText(
    'src/components/Search/searchFilters.test.ts',
    'narrows Madonna music results to an album without replacing the main search',
    'Global Search must retain the Madonna then Prayer two-stage regression case'
  );
  requireText(
    'server/utils/searchTerms.test.ts',
    "toMusicAlbumRefinementQuery('Madonna', 'Prayer')",
    'Music provider search must retain the Madonna then Prayer refinement regression case'
  );
  requireText(
    'src/components/Search/index.tsx',
    "category.key === 'music' && resultFilter",
    'Music Search must send its independent album refinement to the provider'
  );
  requireText(
    'seerr-api.yml',
    'name: resultFilter',
    'the public Search contract must admit the independent music result refinement'
  );
  requireText(
    'src/components/Layout/index.tsx',
    'pointer-events-none absolute top-1 left-0',
    'Global Search progress must use the existing title margin without reflowing the header or page'
  );
  rejectText(
    'src/components/Layout/SearchInput/index.tsx',
    'useSearchActivity',
    'the fixed global search header must not own the progress indicator'
  );
  requireText(
    'src/components/RequestStatus/index.tsx',
    "ebookAndAudiobook: 'Book + Audiobook'",
    'Request Status must use Book terminology for combined requests'
  );
  requireText(
    'src/components/RequestModal/BookRequestModal.tsx',
    'No Book Bookshelf service is configured. Book requests are unavailable.',
    'Book request guidance must use Book terminology'
  );
  requireText(
    'src/i18n/locale/en.json',
    '"i18n.ebook": "Book"',
    'the generated English language catalogue must use Book terminology'
  );
  requireText(
    'src/i18n/locale/en.json',
    '"components.RequestStatus.ebookAndAudiobook": "Book + Audiobook"',
    'the English Request Status translation must use Book terminology'
  );

  const globals = 'src/styles/globals.css';
  requireText(
    globals,
    '.app-blocklist-confirmation-card',
    'shared Blocklist confirmation must define one global card style'
  );
  requireText(
    globals,
    'max-width: 18rem !important;',
    'Blocklist confirmation must remain twice the compact genre-card width'
  );
  requireText(
    globals,
    'min-height: 9rem;',
    'Blocklist confirmation must remain twice the compact genre-card height'
  );
  for (const variant of [
    'blocklist',
    'manage',
    'report-issue',
    'association',
    'bulk-request',
    'detail-request',
    'trailer',
  ]) {
    requireText(
      globals,
      `.app-button-${variant}`,
      `missing ${variant} button role`
    );
  }
  for (const variant of [
    'blocklist',
    'manage',
    'report-issue',
    'association',
    'bulk-request',
    'detail-request',
    'trailer',
  ]) {
    const source = requireFile(globals);
    const start = source.indexOf(`.app-button-${variant} {`);
    const end = source.indexOf('\n  }', start);
    if (
      start < 0 ||
      end < 0 ||
      !source.slice(start, end).includes('hover:text-white')
    ) {
      errors.push(`${globals}: ${variant} button must turn white on hover`);
    }
  }
  requireText(
    globals,
    '.button-sm {\n    @apply h-8',
    'small buttons must be 32px high'
  );
  requireText(
    globals,
    '.app-button-report-issue {\n    @apply border-yellow',
    'Report an Issue must use true yellow styling'
  );
  requireText(
    globals,
    '.app-button-trailer {\n    @apply border-orange',
    'Watch Trailer must use orange styling'
  );
  requireText(
    globals,
    '.app-button-association {\n    @apply border-cyan',
    'Associations must use aqua styling'
  );
  requireText(
    'src/components/Association/AssociationBadge.tsx',
    "'app-button app-button-association h-6 w-6 rounded-full p-0",
    'the poster Associations action must reuse the shared association button style'
  );
  requireText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'data-testid="poster-quality-status-badge"',
    'poster quality states must use the shared rounded status badge'
  );
  requireOrder(
    'src/components/Common/StatusBadgeMini/index.tsx',
    [
      "pendingApproval: '{quality}: Pending approval'",
      "approvedProcessing: '{quality}: Approved and processing'",
      '<Tooltip content={tooltipLabel}>',
    ],
    'pending bell and processing timer badges must explain their meaning in tooltips'
  );
  requireText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]',
    'poster quality states must match the rounded media-type badge silhouette'
  );
  requireText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'bg-indigo-700/35',
    'processing timer badges must preserve the translucent poster surface'
  );
  requireText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'bg-yellow-700/35',
    'pending bell badges must preserve the translucent poster surface'
  );
  requireText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'bg-green-700/35',
    'available quality badges must use the same resting transparency as buttons'
  );
  rejectText(
    'src/components/Common/StatusBadgeMini/index.tsx',
    'bg-green-700/70',
    'poster availability badges must not restore the former opaque surface'
  );
  for (const [fileName, token, description] of [
    [
      'src/components/Common/MediaTypeBadge/index.tsx',
      'bg-blue-700/35',
      'media-type badges must use the shared button resting transparency',
    ],
    [
      'src/components/Common/BookFormatBadge/index.tsx',
      'bg-amber-700/35',
      'book-format badges must use the shared button resting transparency',
    ],
    [
      'src/components/Common/Badge/index.tsx',
      'bg-indigo-500/35',
      'shared badges must use the shared button resting transparency',
    ],
  ]) {
    requireText(fileName, token, description);
  }
  requireOrder(
    'src/components/Common/StatusBadgeMini/index.tsx',
    [
      'data-testid="poster-quality-status-badge"',
      '<span>{quality}</span>',
      '<AvailabilityIcon',
    ],
    'available poster qualities must place the outlined availability icon after the green quality label'
  );
  requireOrder(
    'src/components/TitleCard/index.tsx',
    [
      'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto]',
      '{primaryStatusBadge && (',
      '<AssociationBadge',
      '{secondaryStatusBadge && (',
    ],
    'poster overlays must keep primary status on row one, Associations on row two left, and secondary status on row two right'
  );
  requireOrder(
    'src/components/TitleCard/index.tsx',
    [
      'const canShowBlocklistAction =',
      '{primaryStatusBadge && (',
      '{!primaryStatusBadge && canShowBlocklistAction && (',
      '<AssociationBadge',
    ],
    'the no-request blocklist action must occupy the empty top-right poster status slot'
  );
  requireText(
    'server/lib/musicQualityAvailability.ts',
    'export const getMusicQualityStatuses',
    'music posters must preserve separate MP3 and FLAC request states'
  );
  requireText(
    'src/components/RequestModal/MusicRequestModal.tsx',
    'initialServerId !== undefined',
    'zero-valued Lidarr service IDs must remain valid explicit music destinations'
  );
  requireText(
    'src/components/RequestModal/PlaylistImportModal.tsx',
    'dialogClass="request-modal-site-surface refreshed-detail-text rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:max-w-3xl"',
    'playlist import must use the shared site-background card surface'
  );
  requireText(
    'src/components/RequestModal/PlaylistImportModal.tsx',
    'className="request-form-control mt-2 block h-10 w-full',
    'playlist URL input must use the shared request control styling'
  );
  requireText(
    'src/components/Discover/index.tsx',
    '<div className="discover-home">',
    'Discover must scope its larger poster-card treatment to the home page'
  );
  requireText(
    globals,
    '.discover-home .title-card-shell',
    'Discover poster cards must retain their wider responsive sizing'
  );
  requireText(
    'server/routes/request.test.ts',
    'allows simultaneous active music requests for different Lidarr destinations',
    'MP3 and FLAC must retain independent active-request regression coverage'
  );
  requireOrder(
    'src/components/TitleCard/index.tsx',
    ['setIsUpdating(false);', 'setShowRequestModal(false);'],
    'request completion must clear poster-local loading before unmounting the modal'
  );
  requireText(
    'src/components/TitleCard/index.tsx',
    'pointer-events-none absolute inset-0 z-40',
    'poster mutation feedback must never intercept detail navigation'
  );
  requireText(
    globals,
    '.media-rating-icon {\n    @apply h-5 w-5',
    'rating icons must share the tomato height'
  );
  requireText(
    globals,
    '.media-rating-icon-audience {\n    @apply h-4 w-4',
    'audience rating art must be optically normalized to the tomato image height'
  );
  requireText(
    globals,
    '.media-rating-wordmark {\n    @apply h-3.5 w-auto',
    'wide rating wordmarks must be optically normalized to the tomato image height'
  );
  requireText(
    globals,
    '.media-rating-row {\n    @apply flex min-h-8 flex-wrap items-center justify-between gap-x-3',
    'playback actions and ratings must use the compact full-width shared row'
  );
  requireText(
    globals,
    '.availability-quality-control',
    'quality availability must use one shared segmented control style'
  );
  requireText(
    globals,
    '.refreshed-detail-text',
    'refreshed detail text must use the shared palette-aware content tone'
  );
  requireText(
    globals,
    '.media-primary-action-row',
    'detail primary actions must use one shared full-width row'
  );
  requireText(
    globals,
    '.media-availability-cell',
    'availability headings and status icons must share one centered cell style'
  );
  for (const fileName of [
    'src/components/MediaDetails/SeriesSeasonEpisodeBrowser.tsx',
    'src/components/MediaDetails/AlbumTrackList.tsx',
    'src/components/MediaDetails/PlaybackTrackList.tsx',
  ]) {
    requireText(
      fileName,
      'className="media-availability-cell"',
      'availability headings and row status icons must use the shared centered cell'
    );
    rejectText(
      fileName,
      'mx-auto h-4 w-4 text-green-400',
      'availability icons must not use standalone margin centering'
    );
  }
  requireText(
    'src/components/Discover/FilterPanel/index.tsx',
    'order-[13]',
    'streaming services must remain after Clear Filters and Title View'
  );
  rejectText(
    'src/components/Discover/FilterPanel/index.tsx',
    'order-13',
    'Tailwind does not generate the non-standard order-13 utility'
  );
  for (const fileName of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'src/components/TvDetails/SeriesDetailsLayout.tsx',
    'src/components/MusicDetails/MusicDetailsLayout.tsx',
    'src/components/BookDetails/BookDetailsLayout.tsx',
    'src/components/CollectionDetails/index.tsx',
  ]) {
    requireText(
      fileName,
      'refreshed-detail-text',
      'every refreshed media detail card must inherit the shared blue content tone'
    );
    requireText(
      fileName,
      'media-primary-action-row',
      'every refreshed media detail card must distribute primary actions across the full row'
    );
  }

  for (const [fileName, ratingRowToken] of [
    [
      'src/components/MovieDetails/MovieDetailsLayout.tsx',
      'className="media-rating-row"',
    ],
    [
      'src/components/TvDetails/SeriesDetailsLayout.tsx',
      'className="media-rating-row"',
    ],
    [
      'src/components/MusicDetails/MusicDetailsLayout.tsx',
      'className="media-rating-row"',
    ],
    [
      'src/components/BookDetails/BookDetailsLayout.tsx',
      'className="media-rating-row justify-start"',
    ],
    [
      'src/components/CollectionDetails/index.tsx',
      'className="media-rating-row"',
    ],
  ]) {
    requireOrder(
      fileName,
      [ratingRowToken, 'className="media-primary-action-row"'],
      'playback and ratings must appear above the primary action row'
    );
  }
  for (const fileName of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'src/components/TvDetails/SeriesDetailsLayout.tsx',
    'src/components/BookDetails/BookDetailsLayout.tsx',
  ]) {
    requireText(
      fileName,
      '<AvailabilityValue',
      'paired media-detail availability values must use the shared semantic color component'
    );
  }
  requireText(
    'src/components/MediaDetails/AvailabilityValue.tsx',
    "available: 'text-emerald-300'",
    'available media-detail values must use the shared green tone'
  );
  requireText(
    'src/components/MediaDetails/AvailabilityValue.tsx',
    "processing: 'text-amber-300'",
    'processing media-detail values must use the shared yellow tone'
  );
  requireText(
    'src/components/MediaDetails/AvailabilityValue.tsx',
    "unavailable: 'text-red-300'",
    'unavailable media-detail values must use the shared red tone'
  );
  for (const fileName of [
    'src/components/MovieDetails/index.tsx',
    'src/components/TvDetails/index.tsx',
    'src/components/MusicDetails/index.tsx',
    'src/components/BookDetails/index.tsx',
  ]) {
    rejectText(
      fileName,
      'ml-auto hidden sm:block',
      'detail primary actions must not use an auto-margin spacer'
    );
  }
  requireText(
    globals,
    '.selection-circle {\n    @apply flex h-4 w-4 flex-none items-center justify-center rounded-full border border-gray-600 bg-gray-800 text-transparent',
    'selection circles must use the fixed global inactive geometry and palette'
  );
  requireText(
    globals,
    ".selection-circle[aria-pressed='true'] {\n    @apply border-emerald-400 bg-emerald-500 text-white;",
    'selected circles must use the established green fill and white check state'
  );
  requireText(
    globals,
    ".selection-circle[data-partial='true'] {\n    @apply border-emerald-600 bg-emerald-800 text-white;",
    'partially selected seasons must use the shared dark-green circle state'
  );
  requireText(
    globals,
    '.selection-circle-icon {\n    @apply h-3 w-3;',
    'selection-circle icon geometry must remain global'
  );
  requireText(
    globals,
    '.playback-button-label {\n    @apply inline-flex min-w-0 items-center gap-2 leading-none;',
    'playback labels must share centered text and explicit logo spacing'
  );
  requireText(
    globals,
    'svg.playback-provider-icon {\n    @apply m-0 h-[1em] w-auto max-w-12 flex-none;',
    'playback provider artwork must preserve full text-height sizing and intrinsic aspect ratio'
  );
  requireText(
    globals,
    '.app-search-input {',
    'global search must consume the shared blue control surface'
  );
  requireText(
    'package.json',
    'node bin/check-current-batch-contract.js && node bin/check-refreshed-ui-style.js',
    'the current batch gate must run the refreshed UI style-boundary validator'
  );
  requireText(
    'bin/check-refreshed-ui-style-lib.test.mjs',
    'rejects visual inline and embedded styles in refreshed components',
    'the style-boundary validator must retain inline and embedded-style regression coverage'
  );
  requireText(
    globals,
    '.app-filter-button-idle {',
    'inactive filter controls must consume the shared blue control surface'
  );
  requireText(
    globals,
    '.app-filter-section-gap {',
    'filter categories must use the shared larger vertical gap'
  );
  requireText(
    globals,
    '.app-filter-section-heading {',
    'discovery filter headings must use the shared larger vertical gap'
  );
  for (const fileName of [
    'src/components/Search/index.tsx',
    'src/components/RequestStatus/index.tsx',
    'src/components/IssueList/index.tsx',
    'src/components/Blocklist/index.tsx',
  ]) {
    requireText(
      fileName,
      'app-filter-section-gap',
      'filter categories must retain the shared larger vertical gap'
    );
  }
  for (const fileName of [
    'src/components/Discover/DiscoverMovies/index.tsx',
    'src/components/Discover/DiscoverTv/index.tsx',
    'src/components/Discover/DiscoverMusic/index.tsx',
    'src/components/Discover/DiscoverBooks/index.tsx',
  ]) {
    requireText(
      fileName,
      'app-filter-section-heading',
      'discovery filter categories must retain the shared larger vertical gap'
    );
  }
  for (const fileName of [
    'src/components/Common/BookFormatSelector/index.tsx',
    'src/components/Common/CardTextVisibilityToggle/index.tsx',
    'src/components/Discover/FilterPanel/index.tsx',
    'src/components/Blocklist/index.tsx',
    'src/components/IssueList/index.tsx',
    'src/components/RequestStatus/index.tsx',
  ]) {
    requireText(
      fileName,
      'getFilterToggleButtonClass',
      'neutral filter buttons must consume the shared global blue control style'
    );
    rejectText(
      fileName,
      "'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'",
      'neutral filter buttons must not restore the copied near-black component style'
    );
  }
  for (const fileName of [
    'src/components/MediaSlider/index.tsx',
    'src/components/Slider/index.tsx',
  ]) {
    rejectText(
      fileName,
      'border-gray-600 bg-gray-900/70',
      'neutral slider controls must use the shared global button style'
    );
  }
  requireText(
    globals,
    'linear-gradient(\n        40deg,',
    'page gradient must use 40 degrees'
  );
  requireText(
    globals,
    'rgb(var(--theme-page-gradient-black)) 0%',
    'page gradient must end in black'
  );
  requireText(
    globals,
    '.refreshed-card-surface {\n    background-color: rgb(var(--theme-page-gradient-main) / 0.38);\n    color: rgb(var(--theme-control-text) / 0.86)',
    'refreshed cards must use the translucent blue surface and content-tone standard'
  );
  requireText(
    globals,
    '.refreshed-inset-surface {\n    background-color: rgb(var(--theme-control-surface) / 0.42);\n    color: rgb(var(--theme-control-text) / 0.86)',
    'refreshed inset cards must use the darker translucent control surface without changing outer cards'
  );
  requireText(
    globals,
    '.request-form-control {\n    @apply border-gray-600 bg-gray-900/70 text-gray-300;',
    'request controls must match the dark Destination Server dropdown treatment'
  );
  requireText(
    globals,
    '.request-divider-dark {\n    border-color: rgb(var(--color-gray-900) / 0.7);',
    'request table and details dividers must match the Destination Server value background'
  );
  requireText(
    globals,
    '.request-divider-dark.border-t {\n    border-top-width: 2px !important;',
    'request horizontal dividers must remain two pixels wide'
  );
  requireText(
    globals,
    '.request-divider-dark::before {\n    width: 2px !important;',
    'request vertical dividers must remain two pixels wide'
  );
  requireText(
    globals,
    '.request-modal-site-surface {',
    'full-size request surfaces must expose the shared site-gradient treatment'
  );
  for (const fileName of [
    'src/components/RequestStatus/index.tsx',
    'src/components/Blocklist/index.tsx',
    'src/components/IssueList/IssueItem/index.tsx',
    'src/components/IssueDetails/index.tsx',
  ]) {
    requireText(
      fileName,
      'refreshed-detail-text',
      'workflow and issue cards must use the shared blue content tone'
    );
  }
  requireText(
    globals,
    '.slider-item-compact {\n    contain-intrinsic-inline-size: auto 9rem;\n    contain-intrinsic-block-size: auto 4.5rem;',
    'compact Discover cards must retain half-size intrinsic geometry'
  );

  const button = 'src/components/Common/Button/index.tsx';
  const splitButton = 'src/components/Common/ButtonWithDropdown/index.tsx';
  requireText(
    button,
    "'app-button'",
    'buttons must consume the shared semantic base'
  );
  requireText(
    button,
    "disabledReason ?? 'This action is unavailable in the current state.'",
    'every disabled shared button must expose an explanatory tooltip'
  );
  for (const disabledToken of [
    'disabled:cursor-not-allowed',
    'disabled:brightness-50',
    'disabled:grayscale',
  ]) {
    requireText(
      globals,
      disabledToken,
      'disabled buttons must be darkened and use the prohibited cursor'
    );
  }
  requireText(
    splitButton,
    'const sharedClasses = `app-button',
    'split request buttons must consume the shared semantic base'
  );
  requireText(
    splitButton,
    "disabledReason ?? 'This action is unavailable in the current state.'",
    'disabled split buttons must expose an explanatory tooltip'
  );
  rejectText(
    splitButton,
    'const buttonStyle =',
    'must not restore per-component button colors'
  );
  const requestButton = 'src/components/RequestButton/index.tsx';
  requireText(
    requestButton,
    '<FormatRequestControl options={requestOptions}',
    'Movie and Series detail requests must use the shared segmented control'
  );
  requireText(
    requestButton,
    'canChooseAlternateTarget',
    'Movie and Series entry controls must not hide valid alternate destinations'
  );
  requireText(
    requestButton,
    'Permission.REQUEST_4K_MOVIE',
    'Movie 4K request visibility must remain permission-gated'
  );
  requireText(
    requestButton,
    'Permission.REQUEST_4K_TV',
    'Series 4K request visibility must remain permission-gated'
  );
  requireText(
    'cypress/e2e/movie-details.cy.ts',
    'hides the 4K request action without 4K request permission',
    'Movie details must test that the 4K action is hidden without permission'
  );
  for (const fileName of [
    'cypress/e2e/movie-details.cy.ts',
    'cypress/e2e/tv-details.cy.ts',
  ]) {
    requireText(
      fileName,
      'shows standard and 4K requests in one segmented control',
      'Movie and Series details must test the shared segmented request control'
    );
  }

  const dropdown = 'src/components/Common/Dropdown/index.tsx';
  requireText(
    dropdown,
    "buttonSize?: 'default' | 'md' | 'sm';",
    'dropdown triggers must expose standard shared sizing'
  );
  requireText(
    dropdown,
    "buttonSize === 'sm' ? 'button-sm' : 'button-md'",
    'small dropdown triggers must not inherit the oversized default geometry'
  );
  for (const fileName of [
    'src/components/Common/MediaServerPlayButton/index.tsx',
    'src/components/Common/PlayOnDeviceButton/index.tsx',
    'src/components/CollectionDetails/CollectionPlayOnDeviceButton.tsx',
  ]) {
    const source = requireFile(fileName);
    if (
      !source.includes('buttonSize="sm"') &&
      !source.includes("buttonSize = 'sm'")
    ) {
      errors.push(
        `${fileName}: playback triggers must use the shared small height`
      );
    }
    requireText(
      fileName,
      'className="playback-provider-icon"',
      'media-server artwork must consume the shared text-height provider-logo standard'
    );
  }
  requireText(
    'src/components/Common/PlayButton/index.tsx',
    'className="playback-button-label"',
    'direct and dropdown playback links must retain centered logo spacing'
  );

  requireOrder(
    requestButton,
    ["id: 'decline-request'", "buttonType: 'danger'"],
    'single-request decline must use the semantic red button role'
  );
  requireOrder(
    requestButton,
    ["id: 'decline-4k-request'", "buttonType: 'danger'"],
    '4K decline must use the semantic red button role'
  );
  requireText(
    requestButton,
    'buttonType={button.buttonType ?? buttonType}',
    'request actions must prefer their semantic approve or decline role'
  );

  const detailIndexes = [
    'src/components/MovieDetails/index.tsx',
    'src/components/TvDetails/index.tsx',
    'src/components/MusicDetails/index.tsx',
    'src/components/BookDetails/index.tsx',
  ];
  for (const fileName of detailIndexes) {
    requireOrder(
      fileName,
      [
        'buttonType="blocklist"',
        'buttonType="manage"',
        'buttonType="reportIssue"',
      ],
      'detail actions must begin Blocklist, Manage, then Report an Issue'
    );
    requireText(
      fileName,
      'buttonSize="sm"',
      'detail actions must use standard sizing'
    );
    requireText(
      fileName,
      'disabledReason={intl.formatMessage(',
      'state-disabled detail actions must explain why they are unavailable'
    );
    requireText(
      fileName,
      'canUseManage',
      'Manage visibility must be permission-based rather than media-state-based'
    );
    requireText(
      fileName,
      'isManageAvailable',
      'Manage must remain visible but disabled when media state blocks it'
    );
    requireText(
      fileName,
      'canUseReportIssue',
      'Report an Issue visibility must be permission-based'
    );
    requireText(
      fileName,
      'isReportIssueAvailable',
      'Report an Issue must remain visible but disabled until media is available'
    );
    requireText(
      fileName,
      'MediaServerPlayButton',
      'detail pages must retain the approved Play on media server action'
    );
    const source = requireFile(fileName);
    const reportStart = source.indexOf('buttonType="reportIssue"');
    const reportEnd = source.indexOf('</Button>', reportStart);
    const reportBlock = source.slice(reportStart, reportEnd);
    if (
      reportStart < 0 ||
      reportEnd < 0 ||
      !reportBlock.includes('<ExclamationTriangleIcon') ||
      reportBlock.includes('<span')
    ) {
      errors.push(
        `${fileName}: Report an Issue must be an icon-only tooltip action`
      );
    }
    rejectText(
      fileName,
      'status !== MediaStatus.AVAILABLE &&',
      'Blocklist must remain available for media already in the library'
    );
    rejectText(
      fileName,
      'showHideButton && isUnavailable',
      'Blocklist must not disappear for available or processing media'
    );
  }
  requireText(
    'server/api/openlibrary/index.ts',
    'Array.isArray(data.docs) && data.docs.length > 0',
    'Open Library search must evict and retry unusable empty provider cache entries'
  );

  for (const fileName of [
    'src/components/MovieDetails/index.tsx',
    'src/components/TvDetails/index.tsx',
  ]) {
    requireOrder(
      fileName,
      ['buttonType="trailer"', '<AssociationBadge'],
      'Watch Trailer must be immediately to the left of Associations'
    );
  }

  const credits = 'src/components/MediaDetails/ExpandableCreditList.tsx';
  requireText(
    credits,
    'grid-cols-3',
    'cast and crew must render three person cards per row'
  );
  requireText(
    credits,
    'max-h-[252px]',
    'cast and crew must show three rows before scrolling'
  );
  requireText(
    credits,
    '/images/camera-shy-profile-placeholder.png',
    'cast and crew must use the approved Camera Shy fallback'
  );
  requireText(
    credits,
    'href={`/person/${credit.id}`}',
    'person cards must link to details'
  );

  const disclosure = 'src/components/MediaDetails/DetailDisclosureButton.tsx';
  requireText(
    disclosure,
    'className="detail-disclosure-control"',
    'detail disclosures must use the shared segmented control surface'
  );
  requireText(
    disclosure,
    'const PushPinIcon =',
    'detail disclosure pins must use the conventional pushpin icon'
  );
  requireText(
    disclosure,
    "fill={filled ? 'currentColor' : 'none'}",
    'the unpinned pushpin interior must remain transparent'
  );
  rejectText(
    disclosure,
    'MapPinIcon',
    'detail disclosure pins must not regress to map-location icons'
  );
  requireText(
    globals,
    '.detail-disclosure-control {\n    @apply inline-flex h-[22px] items-stretch overflow-hidden rounded-md border border-gray-600 bg-gray-900/70',
    'Cast, Crew, and Subject Tags must match the Destination Server dropdown surface'
  );
  requireText(
    disclosure,
    'className="detail-disclosure-button"',
    'detail disclosure controls must consume one shared style'
  );
  requireText(
    disclosure,
    'aria-pressed={pinned}',
    'detail disclosure pins must expose their selected state'
  );
  requireOrder(
    disclosure,
    [
      'className={`detail-disclosure-pin',
      'aria-pressed={pinned}',
      '{label}',
      '<ChevronDownIcon',
    ],
    'the selectable pin must precede the disclosure label and unfold icon'
  );

  requireText(
    'src/hooks/useDetailDisclosurePins.ts',
    '/settings/detail-disclosures',
    'detail disclosure pins must use the authenticated per-user settings endpoint'
  );
  requireText(
    'src/hooks/useDetailDisclosurePins.ts',
    'optimisticData: mutation.next',
    'detail disclosure pins must update optimistically'
  );
  requireCount(
    'server/routes/user/usersettings.ts',
    "'/detail-disclosures'",
    2,
    'detail disclosure pin settings must expose one read and one write route'
  );
  for (const fieldName of [
    'detailDisclosureCastPinned',
    'detailDisclosureCrewPinned',
    'detailDisclosureSubjectTagsPinned',
  ]) {
    requireText(
      'server/entity/UserSettings.ts',
      fieldName,
      `user settings must persist ${fieldName}`
    );
    requireText(
      'server/migration/sqlite/1785000000000-AddDetailDisclosurePins.ts',
      fieldName,
      `SQLite migration must add ${fieldName}`
    );
    requireText(
      'server/migration/postgres/1785000000000-AddDetailDisclosurePins.ts',
      fieldName,
      `PostgreSQL migration must add ${fieldName}`
    );
  }
  requireText(
    'seerr-api.yml',
    '/user/{userId}/settings/detail-disclosures:',
    'the public API contract must document persistent detail disclosure pins'
  );

  for (const fileName of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'src/components/TvDetails/SeriesDetailsLayout.tsx',
    'src/components/CollectionDetails/CollectionMetadataDisclosures.tsx',
  ]) {
    requireText(
      fileName,
      'className="mt-[5px] flex flex-wrap items-center gap-2"',
      'the disclosure row must keep the same five-pixel gap above and below'
    );
    requireText(
      fileName,
      "onPinClick={() => void togglePinned('cast')}",
      'Cast must expose its persistent pin'
    );
    requireText(
      fileName,
      "onPinClick={() => void togglePinned('crew')}",
      'Crew must expose its persistent pin'
    );
    requireText(
      fileName,
      "onPinClick={() => void togglePinned('subjectTags')}",
      'Subject Tags must expose its persistent pin'
    );
  }
  requireText(
    'src/components/MusicDetails/MusicDetailsLayout.tsx',
    "onPinClick={() => void togglePinned('subjectTags')}",
    'the Subject Tags pin must carry into Music details'
  );

  const mediaDetailArtwork =
    'src/components/MediaDetails/MediaDetailArtwork.tsx';
  requireText(
    mediaDetailArtwork,
    "'--media-detail-artwork-url': `url(${JSON.stringify(resolvedSrc)})`",
    'the Firefox artwork fallback must reuse the resolved cached image URL'
  );
  requireText(
    mediaDetailArtwork,
    'className="media-detail-artwork-image object-cover object-top"',
    'the standard artwork image must preserve the expanding cover behavior'
  );
  requireText(
    globals,
    '@supports (-moz-appearance: none)',
    'the dynamic artwork workaround must remain Firefox-specific'
  );
  requireText(
    globals,
    'background-image: var(--media-detail-artwork-url);',
    'Firefox must render expanding detail artwork through a stable background layer'
  );
  requireText(
    globals,
    '.media-detail-artwork-image {\n      opacity: 0;',
    'Firefox must hide the replaced-image paint path that accumulates zoom'
  );

  const advancedRequester =
    'src/components/RequestModal/AdvancedRequester/index.tsx';
  requireText(
    advancedRequester,
    'open={panelOnly ? expanded : true}',
    'non-panel Advanced Options must remain visible'
  );
  requireText(
    advancedRequester,
    '(serverData?.rootFolders.length ?? 0) > 5',
    'root-folder scrolling must begin only after five rows'
  );
  requireText(
    advancedRequester,
    "'max-h-[8.5rem] overflow-y-auto pr-1'",
    'long root-folder tables must scroll their data rows'
  );
  requireText(
    advancedRequester,
    'className="request-divider-dark col-span-2 mb-1 grid grid-cols-subgrid border-b px-1 pb-2"',
    'root-folder table rules must use the dark Destination Server color'
  );
  requireText(
    advancedRequester,
    'className="request-form-control relative inline-flex h-[22px]',
    'Requested By must use the dark Destination Server control treatment'
  );
  requireText(
    advancedRequester,
    'const selectableUserData = userData?.results;',
    'request managers must be able to select every Seerr user'
  );
  requireText(
    advancedRequester,
    'const RequestListboxControl =',
    'Destination Server and Quality Profile must share the Requested By listbox treatment'
  );
  requireText(
    advancedRequester,
    'rounded-r-[5px] bg-transparent',
    'request listbox value buttons must not stack an opaque surface over the shared translucent control'
  );
  requireText(
    advancedRequester,
    '<CheckIcon',
    'request listbox menus must mark their selected option with a check icon'
  );
  requireText(
    'server/entity/MediaRequest.ts',
    'const isManagedRequestForAnotherUser =',
    'request managers must be able to submit a configured tier on behalf of any selected user'
  );
  for (const fileName of [
    'src/components/RequestModal/MovieRequestModal.tsx',
    'src/components/RequestModal/TvRequestModal.tsx',
    'src/components/RequestModal/MusicRequestModal.tsx',
    'src/components/RequestModal/BookRequestModal.tsx',
  ]) {
    requireText(
      fileName,
      'useState(true)',
      'fresh request forms must open Advanced Options by default'
    );
    requireText(
      fileName,
      'className="request-form-control inline-flex h-[22px]',
      'Advanced Options buttons must match the Destination Server control treatment'
    );
  }
  for (const fileName of [
    'src/components/RequestModal/MovieRequestModal.tsx',
    'src/components/RequestModal/TvRequestModal.tsx',
    'src/components/RequestModal/MusicRequestModal.tsx',
    'src/components/RequestModal/BookRequestModal.tsx',
    'src/components/RequestModal/CollectionRequestModal.tsx',
    'src/components/RequestModal/BulkRequestModal.tsx',
  ]) {
    requireText(
      fileName,
      'request-modal-site-surface sm:max-w-5xl',
      'full-size request cards must use the site background gradient'
    );
  }
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'same dark `gray-900` at 70-percent opacity surface and `gray-600` border as the Destination Server dropdown',
    'the style standard must document the shared dark request-control treatment'
  );
  requireText(
    'docs/maintainers/current-batch-acceptance-ledger.md',
    '## Request-card contrast and Advanced Options',
    'the acceptance ledger must retain the request-card contrast work'
  );

  for (const fileName of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'src/components/TvDetails/SeriesDetailsLayout.tsx',
  ]) {
    requireText(
      fileName,
      'className="media-rating-row"',
      'must use the shared rating row'
    );
    requireText(
      fileName,
      'className="media-rating-wordmark"',
      'wordmarks must use shared sizing'
    );
    requireText(
      fileName,
      '<ExpandableCreditList',
      'must use the shared three-across credit list'
    );
    requireText(
      fileName,
      'refreshed-card-surface refreshed-detail-text relative overflow-hidden',
      'artwork must live inside the main card'
    );
    requireText(
      fileName,
      '<MediaDetailArtwork',
      'artwork-backed detail cards must use the stable shared artwork layer'
    );
    requireText(
      fileName,
      '<DetailDisclosureButton',
      'detail panels must use the shared disclosure control'
    );
    rejectText(
      fileName,
      'const DropdownButton =',
      'must not restore per-page disclosure styling'
    );
  }

  for (const fileName of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'src/components/TvDetails/SeriesDetailsLayout.tsx',
    'src/components/BookDetails/BookDetailsLayout.tsx',
  ]) {
    requireText(
      fileName,
      'data-testid="media-details-poster"',
      'main detail cards must retain the standard contained poster'
    );
    requireText(
      fileName,
      'sm:grid-cols-[80px_minmax(0,1fr)]',
      'main detail cards must retain the responsive poster and detail geometry'
    );
    requireText(
      fileName,
      'data-testid="media-details-genres"',
      'main detail cards must retain the shared Genres row'
    );
    requireText(
      fileName,
      'card:grid-cols-[max-content_0.75rem_6rem_0.75rem_1px_0.75rem_minmax(0,1fr)]',
      'main detail cards must keep the first two detail groups in one shared table grid'
    );
    requireText(
      fileName,
      'card:col-span-5 card:col-start-3',
      'main detail card Genres value must begin in the first value column and span through the second detail group'
    );
    requireText(
      fileName,
      'min-w-0 break-words',
      'main detail card Genres value must wrap naturally within its combined width'
    );
    rejectText(
      fileName,
      'line-clamp-2 min-w-0',
      'main detail card Genres value must wrap rather than be clamped'
    );
    requireText(
      fileName,
      'media-primary-action-row',
      'detail actions must use one full-width justified wrapping row'
    );
  }

  const musicLayout = 'src/components/MusicDetails/MusicDetailsLayout.tsx';
  for (const [token, description] of [
    [
      'data-testid="media-details-poster"',
      'Music details must retain the standard contained poster',
    ],
    [
      'sm:grid-cols-[80px_minmax(0,1fr)]',
      'Music details must retain the responsive poster and detail geometry',
    ],
    [
      'data-testid="media-details-genres"',
      'Music details must retain the shared Genres row',
    ],
    [
      'card:grid-cols-3',
      'Music details must divide the post-poster detail space into equal thirds',
    ],
    [
      'media-primary-action-row',
      'Music detail actions must retain the shared full-width row',
    ],
  ]) {
    requireText(musicLayout, token, description);
  }
  rejectText(
    musicLayout,
    'totalListeners',
    'Total Listeners must stay removed'
  );
  rejectText(musicLayout, 'totalListens', 'Total Listens must stay removed');
  requireText(
    musicLayout,
    'musicbrainz.org/search?query=',
    'Origin must remain a navigable MusicBrainz link'
  );
  rejectText(
    musicLayout,
    'qualityLabels.map',
    'Music details must not repeat MP3 and FLAC badges beneath the title'
  );
  rejectText(
    musicLayout,
    "import Badge from '@app/components/Common/Badge';",
    'Music details must not render the removed overall availability badge beneath the title'
  );
  requireOrder(
    musicLayout,
    ["(['MP3', 'FLAC'] as const)", 'qualityAvailability.map'],
    'Music details must list MP3 availability before FLAC availability'
  );
  requireText(
    musicLayout,
    "tone={available ? 'available' : 'unavailable'}",
    'Music quality availability values must use shared green and red semantic tones'
  );
  requireText(
    musicLayout,
    '<AlbumTrackList',
    'music details must use the shared track selection layout'
  );
  requireText(
    musicLayout,
    'catalog={playbackCatalog}',
    'music track selection must use the media-server availability catalog'
  );
  requireText(
    musicLayout,
    'onSelectionChange={setSelectedPlaybackItemIds}',
    'music track selection must control the playback playlist'
  );
  requireText(
    musicLayout,
    '<MediaQualitySelect',
    'Music details must expose the MP3 and FLAC quality selector'
  );
  requireText(
    musicLayout,
    "? 'flac'\n      : 'mp3'",
    'Music details must default to MP3 unless FLAC is the only available quality'
  );
  requireText(
    musicLayout,
    "selectedQuality === 'flac'",
    'Music playback must pass the exact selected quality to server and device actions'
  );
  requireText(
    musicLayout,
    'data-testid="music-playback-rating-row"',
    'music playback and provider rating must share the standard rating row'
  );
  requireText(
    musicLayout,
    "ratingData.rating.source === 'lidarr'",
    'music ratings must visibly identify the Lidarr fallback source'
  );
  requireText(
    musicLayout,
    'const safeRatingUrl = getSafeHref(ratingData?.rating?.url);',
    'music rating links must pass through the shared safe URL boundary'
  );

  const seriesLayout = 'src/components/TvDetails/SeriesDetailsLayout.tsx';
  rejectText(
    seriesLayout,
    'ImdbLogo',
    'must not mislabel an unidentified Series rating as IMDb'
  );
  requireText(
    seriesLayout,
    '<SeriesSeasonEpisodeBrowser',
    'series details must use the shared season and episode selector'
  );
  requireText(
    seriesLayout,
    'catalog={playbackCatalog}',
    'series selection must use the media-server availability catalog'
  );
  requireText(
    seriesLayout,
    'onSelectionChange={setSelectedPlaybackItemIds}',
    'series selections must control the playback playlist'
  );
  for (const detailLayout of [
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    seriesLayout,
  ]) {
    requireText(
      detailLayout,
      '<MediaQualitySelect',
      'Movie and Series details must expose the HD and 4K quality selector'
    );
    requireText(
      detailLayout,
      "? '4k'\n      : 'hd'",
      'Movie and Series details must default to HD unless 4K is the only available quality'
    );
    requireText(
      detailLayout,
      "selectedQuality === '4k'",
      'Movie and Series playback must use the exact selected quality'
    );
  }
  const seriesBrowser =
    'src/components/MediaDetails/SeriesSeasonEpisodeBrowser.tsx';
  requireText(
    seriesBrowser,
    'const toggleSeason =',
    'series selection must support selecting all available episodes in a season'
  );
  requireText(
    seriesBrowser,
    'data-testid="season-list"',
    'the read-only season list must retain a stable browser-audit target'
  );
  requireText(
    seriesBrowser,
    'data-testid="episode-list"',
    'the read-only episode list must retain a stable browser-audit target'
  );
  requireText(
    seriesBrowser,
    'disabled={!playableItem}',
    'unavailable episodes must remain visible but cannot be selected'
  );
  requireText(
    seriesBrowser,
    'onClick={() => toggleItems(allPlayableItemIds)}',
    'the Season heading must expose a select-all control'
  );
  requireText(
    seriesBrowser,
    'onClick={() => toggleItems(activeItemIds)}',
    'the Episode heading must expose a select-all control'
  );
  requireText(
    seriesBrowser,
    'className="text-left"',
    'Season, Episode, and Title headings must remain left aligned'
  );
  requireText(
    seriesBrowser,
    'className="text-center"',
    'episode counts and availability headings must remain centered'
  );
  requireText(
    seriesBrowser,
    "import SelectionCircle from '@app/components/Common/SelectionCircle';",
    'Series selection controls must consume the shared SelectionCircle component'
  );

  const albumTrackList = 'src/components/MediaDetails/AlbumTrackList.tsx';
  requireText(
    albumTrackList,
    'onClick={toggleAllTracks}',
    'the Music track selector must expose one all-tracks selection control'
  );
  requireText(
    albumTrackList,
    'columnIndex === 0',
    'only the left Music track-card heading may render the all-tracks selector'
  );
  rejectText(
    albumTrackList,
    'columnItemIds.forEach((itemId) =>',
    'Music track cards must not retain independent per-column select-all behavior'
  );
  requireText(
    albumTrackList,
    "import SelectionCircle from '@app/components/Common/SelectionCircle';",
    'Music track controls must consume the shared SelectionCircle component'
  );

  const selectionCircle = 'src/components/Common/SelectionCircle/index.tsx';
  requireText(
    selectionCircle,
    "import { CheckIcon } from '@heroicons/react/24/solid';",
    'selector component must use the established solid CheckIcon'
  );
  requireText(
    selectionCircle,
    'className="selection-circle"',
    'selector component must delegate its appearance to global CSS'
  );
  requireText(
    selectionCircle,
    'className="selection-circle-icon"',
    'selector icon must delegate its geometry to global CSS'
  );
  rejectText(
    selectionCircle,
    'CheckCircleIcon',
    'outlined availability artwork must never be used by the selection control'
  );
  requireText(
    selectionCircle,
    'data-partial',
    'selection circles must expose the approved partial-season state'
  );
  requireText(
    seriesBrowser,
    'partial={partiallySelected}',
    'Series playback season rows must show partial episode selection'
  );
  requireText(
    'src/components/Common/SeriesSeasonEpisodeSelector.tsx',
    'partial={partial}',
    'Request and Issue season rows must show partial episode selection'
  );
  requireText(
    'docs/maintainers/ui-style-standard.md',
    'The outlined `CheckCircleIcon` and `XCircleIcon` are availability/status symbols only.',
    'the style standard must distinguish selection controls from availability icons'
  );

  for (const selectorConsumer of [
    'src/components/Common/SeriesSeasonEpisodeSelector.tsx',
    seriesBrowser,
    albumTrackList,
    'src/components/MediaDetails/PlaybackTrackList.tsx',
    'src/components/CollectionDetails/index.tsx',
  ]) {
    requireText(
      selectorConsumer,
      "import SelectionCircle from '@app/components/Common/SelectionCircle';",
      'selection controls must consume the shared SelectionCircle component'
    );
    requireText(
      selectorConsumer,
      '<SelectionCircle',
      'selection controls must render the shared SelectionCircle component'
    );
    rejectText(
      selectorConsumer,
      'playback-selection-button',
      'legacy page-local selector styling is forbidden'
    );
    rejectText(
      selectorConsumer,
      'fill-indigo-500/30',
      'availability-icon fill styling must not be reused for selection state'
    );
  }
  rejectText(
    'src/components/Common/SeriesSeasonEpisodeSelector.tsx',
    'const SelectCircle',
    'request and issue selectors must not retain a page-local selector component'
  );
  for (const [componentFile, componentSource] of Object.entries(files)) {
    if (!componentFile.startsWith('src/components/')) continue;

    if (
      componentSource.includes('playback-selection-button') ||
      componentSource.includes('fill-indigo-500/30')
    ) {
      errors.push(
        `${componentFile}: obsolete defective selector styling is forbidden repository-wide`
      );
    }

    const buttonBlocks =
      componentSource.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    if (
      buttonBlocks.some(
        (buttonBlock) =>
          buttonBlock.includes('aria-pressed') &&
          buttonBlock.includes('CheckCircleIcon')
      )
    ) {
      errors.push(
        `${componentFile}: interactive selection controls must use SelectionCircle instead of embedding CheckCircleIcon`
      );
    }
  }

  const bookLayout = 'src/components/BookDetails/BookDetailsLayout.tsx';
  requireText(
    bookLayout,
    'messages.genres',
    'book subjects must be presented as Genres'
  );
  requireText(
    bookLayout,
    '/discover/books?subject=',
    'book Genres must link to matching books'
  );
  requireText(
    bookLayout,
    '<ReactMarkdown',
    'book overview provider Markdown must render as safe links'
  );
  requireText(
    bookLayout,
    'urlTransform={getSafeMarkdownHref}',
    'book overview links must pass through the shared safe URL transform'
  );
  requireText(
    'src/utils/bookMarkdown.test.ts',
    'removes stray emphasis text after an https Markdown link',
    'the observed malformed provider link must have regression coverage'
  );

  const requestModals = [
    'src/components/RequestModal/MovieRequestModal.tsx',
    'src/components/RequestModal/TvRequestModal.tsx',
    'src/components/RequestModal/MusicRequestModal.tsx',
    'src/components/RequestModal/BookRequestModal.tsx',
  ];
  for (const fileName of requestModals) {
    requireText(
      fileName,
      '<RequestMediaCard',
      'request artwork must be inside the main card'
    );
    requireText(
      fileName,
      '<RequestFooterStatus',
      'Approval must render in the request details area'
    );
    requireText(
      fileName,
      'selectedDestinationAvailable',
      'must evaluate selected service/quality availability'
    );
    requireText(
      fileName,
      'selectedDestinationRequested',
      'must evaluate active requests against the selected destination'
    );
    requireText(
      fileName,
      'selectedDestinationCovered',
      'must block duplicate submissions for available and actively requested destinations'
    );
    requireText(
      fileName,
      'disabled={',
      'must disable an unavailable duplicate destination'
    );
    requireText(
      fileName,
      'data-testid="modal-cancel-button"',
      'request modals must retain a stable standard Cancel action target'
    );
    requireText(
      fileName,
      'data-testid="modal-ok-button"',
      'request modals must retain a stable standard submit action target'
    );
  }
  const advanced = 'src/components/RequestModal/AdvancedRequester/index.tsx';
  requireText(
    advanced,
    'grid-cols-[minmax(0,max-content)_max-content]',
    'root folder and available space columns must be adjacent and content-sized'
  );
  requireText(
    advanced,
    'serverData.rootFolders.map((folder)',
    'root folder table must render the available folders'
  );
  rejectText(
    advanced,
    '{name} (Default)',
    'obsolete unnamed Default column must stay removed'
  );
  requireText(
    advanced,
    'invisible col-start-1 row-start-1 whitespace-nowrap',
    'Requested By must size itself to the longest available username'
  );
  const requestMediaCard = 'src/components/RequestModal/RequestMediaCard.tsx';
  requireText(
    requestMediaCard,
    'relative overflow-hidden rounded-xl',
    'request artwork must be clipped inside the full main card'
  );
  requireText(
    requestMediaCard,
    'className="object-cover object-top"',
    'request artwork must fill the full card from the top edge'
  );
  requireText(
    requestMediaCard,
    'className="refreshed-artwork-scrim"',
    'request artwork must use the shared scrim'
  );

  const formatRequestControl =
    'src/components/Common/FormatRequestControl/index.tsx';
  requireText(
    formatRequestControl,
    'data-testid="format-request-control"',
    'format-aware requests must use the shared segmented Request control'
  );

  for (const fileName of [
    'src/components/BookDetails/index.tsx',
    'src/components/MusicDetails/index.tsx',
  ]) {
    requireText(
      fileName,
      'canChooseAlternateTarget',
      'format entry controls must defer exact alternate-target decisions to the request card'
    );
  }
  requireText(
    formatRequestControl,
    'data-testid={`format-request-option-${option.id}`}',
    'segmented format choices must retain stable browser-audit targets'
  );
  requireText(
    formatRequestControl,
    'disabled={option.disabled}',
    'unavailable or pending request formats must stay visible but disabled'
  );

  const collectionDetails = 'src/components/CollectionDetails/index.tsx';
  for (const token of [
    '<MediaDetailArtwork',
    'getTmdbPosterImageVariants(data.posterPath)',
    '<CollectionAssociationsButton',
    '<FormatRequestControl options={requestOptions}',
    '<CollectionPlayOnDeviceButton',
    'mediaIds={effectivePlaybackMediaIds}',
    '<CollectionMetadataDisclosures',
    'max-h-[312px]',
    'messages.availability',
    '<AvailabilityValue',
    "tone={available ? 'available' : 'unavailable'}",
    'card:col-start-1 card:row-start-4',
    'card:col-start-2 card:row-start-4',
    '<SelectionCircle',
  ]) {
    requireText(
      collectionDetails,
      token,
      `refreshed Collection Details contract is missing ${token}`
    );
  }
  rejectText(
    collectionDetails,
    'ButtonWithDropdown',
    'Collection requests must use the shared segmented format control'
  );
  requireText(
    'src/components/MovieDetails/MovieDetailsLayout.tsx',
    'className="object-cover object-top brightness-[0.6]',
    'the Movie Details collection link artwork must remain top aligned'
  );
  for (const forbidden of ['ReportIssue', 'WatchTrailer', 'ManageSlideOver']) {
    rejectText(
      collectionDetails,
      forbidden,
      `Collection action row must omit ${forbidden}`
    );
  }
  requireText(
    'src/components/CollectionDetails/CollectionPlayOnDeviceButton.tsx',
    "axios.post('/api/v1/playback/collection/play'",
    'Collection Play on Device must send the selected movie queue'
  );
  requireText(
    'server/routes/playback.ts',
    "playbackRoutes.post('/collection/play'",
    'server must expose collection playlist playback'
  );
  requireText(
    'server/routes/playback.ts',
    'buildPlexPlaylistWebUrl({',
    'Plex playlist playback must use the dedicated playlist web URL builder'
  );
  requireText(
    'server/lib/plexPlaylistUrl.ts',
    '}/playlist?key=${encodeURIComponent(playlistPageKey)}`',
    'Plex playlist links must use the playlist route and derived container key'
  );
  requireOrder(
    'server/api/plexapi.ts',
    [
      'const key = isRecord(metadata)',
      'boundedPlexText(metadata.key, 256)',
      'return { ratingKey, key, title: safeTitle, playlistType: mediaType }',
    ],
    'Plex playlist creation must retain the returned playlist content key'
  );
  requireText(
    'server/routes/playback.ts',
    'const uniqueMediaIds = [...new Set(requestedMediaIds)]',
    'Collection playback must preserve the ordered unique selection'
  );
  for (const token of [
    'orderCollectionPartsOldestFirst(data?.parts ?? [])',
    'reconcileCollectionPlaybackSelection(',
    'hasManualPlaybackSelection',
    'resolveCanonicalPlaybackSelection(',
    'const effectivePlaybackMediaIds',
    'disabled={availableMediaIds.length === 0}',
    'orderedParts.map((part)',
  ]) {
    requireText(
      collectionDetails,
      token,
      'Collection playback must preserve oldest-first ordering and make an empty selection mean all available items'
    );
  }
  requireText(
    'src/utils/collectionPlaybackSelection.test.ts',
    'preserves an intentionally empty selection after availability refreshes',
    'Collection playback must test the manual empty-selection state'
  );
  const collectionRequestModal =
    'src/components/RequestModal/CollectionRequestModal.tsx';
  for (const token of [
    '<RequestMediaCard',
    '<SelectionCircle',
    'const visibleParts = orderCollectionPartsOldestFirst(',
    'getCollectionPartRequestPresentation(',
    "? 'text-green-400'",
    "? 'text-yellow-300'",
    'messages.readyToRequest',
  ]) {
    requireText(
      collectionRequestModal,
      token,
      'Collection requests must use the shared card, selector, ordering, and status presentation'
    );
  }
  rejectText(
    collectionRequestModal,
    'role="checkbox"',
    'Collection requests must not restore the legacy sliding selection toggles'
  );
  rejectText(
    collectionRequestModal,
    'style={{',
    'Collection request artwork must use shared classes instead of embedded styles'
  );
  requireText(
    'src/utils/collectionRequestState.test.ts',
    'presents ready and available collection status with distinct states',
    'Collection request Ready and Available states must have regression coverage'
  );

  const paginationPages = [
    'src/components/Blocklist/index.tsx',
    'src/components/IssueList/index.tsx',
    'src/components/RequestList/index.tsx',
    'src/components/RequestStatus/index.tsx',
    'src/components/Settings/SettingsLogs/index.tsx',
    'src/components/UserList/index.tsx',
  ];
  for (const fileName of paginationPages) {
    requireText(
      fileName,
      'Common/PaginationFooter',
      'paginated pages must use the Issues footer standard'
    );
  }
  const paginationFooter = 'src/components/Common/PaginationFooter/index.tsx';
  requireText(
    paginationFooter,
    'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    'shared pagination must use stable left, center, and right zones'
  );
  requireOrder(
    paginationFooter,
    [
      'messages.resultsPerPage',
      'messages.page',
      'globalMessages.previous',
      'globalMessages.next',
    ],
    'pagination must place Results Per Page left, page count center, and Previous then Next right'
  );

  const issueDetails = 'src/components/IssueDetails/index.tsx';
  requireOrder(
    issueDetails,
    ['onClick={leaveIssue}', 'messages.exit', 'messages.closeissue'],
    'Exit and Close Issue must retain their swapped placement'
  );
  requireText(
    issueDetails,
    'messages.openBookInBookshelf',
    'Book issues must retain the format-specific Book service action'
  );
  requireText(
    issueDetails,
    'messages.openAudiobookInBookshelf',
    'Book issues must retain the format-specific Audiobook service action'
  );
  requireText(
    issueDetails,
    '<article className="refreshed-card-surface relative overflow-hidden',
    'Issue Details must contain every region in one artwork-backed outer card'
  );
  requireText(
    issueDetails,
    'className="object-cover object-top"',
    'Issue Details outer artwork must fill from the top edge'
  );
  requireText(
    issueDetails,
    '<IssueMediaSummary',
    'Issue Details must retain the standard media summary'
  );
  requireText(
    issueDetails,
    'embedded',
    'the Issue summary must render as an inset inside the outer artwork card'
  );
  requireText(
    issueDetails,
    'className="mt-[5px] max-h-32 w-full',
    'Issue Details comment entry must sit directly beneath Comments without another wrapper card'
  );
  rejectText(
    issueDetails,
    '<div className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-2">\n                    <Field',
    'Issue Details must not wrap the comment textarea in a second inset card'
  );
  requireText(
    'src/components/IssueList/IssueItem/index.tsx',
    'border-emerald-600/80',
    'View Issue must be green'
  );
  const issueList = 'src/components/IssueList/index.tsx';
  requireText(
    issueList,
    "useState<Filter>('all')",
    'Issues must show All Issues by default'
  );
  requireOrder(
    issueList,
    [
      'globalMessages.resolved',
      'intl.formatMessage(messages.issueType)',
      'intl.formatMessage(messages.mediaFilters)',
      'intl.formatMessage(messages.filters)',
    ],
    'Issues must separate Task Filters, Media Filters, and regular Filters'
  );
  for (const fileName of [
    'src/components/RequestStatus/index.tsx',
    'src/components/Blocklist/index.tsx',
  ]) {
    requireOrder(
      fileName,
      [
        'intl.formatMessage(messages.taskFilters)',
        'intl.formatMessage(messages.mediaFilters)',
        'intl.formatMessage(messages.filter',
      ],
      'workflow pages must separate Task Filters, Media Filters, and regular Filters'
    );
  }
  requireText(
    'src/components/IssueModal/CreateIssueModal/index.tsx',
    'getAvailableIssueQualities(data?.mediaInfo)',
    'issue quality choices must reflect current HD/4K availability'
  );
  const issueSummary = 'src/components/IssueDetails/IssueMediaSummary.tsx';
  requireText(
    issueSummary,
    'embedded?: boolean;',
    'issue summaries must support the outer-card embedded treatment'
  );
  requireText(
    issueSummary,
    "embedded ? 'refreshed-inset-surface' : 'refreshed-card-surface shadow-lg shadow-gray-950/20'",
    'embedded Issue Details summary must use the shared inset transparency'
  );
  rejectText(
    issueSummary,
    'refreshed-card-surface overflow-hidden',
    'the full card may not clip an open issue-type dropdown'
  );
  const createIssue = 'src/components/IssueModal/CreateIssueModal/index.tsx';
  requireOrder(
    createIssue,
    [
      'IssueType.OTHER',
      'IssueType.AUDIO',
      'IssueType.VIDEO',
      'IssueType.SUBTITLES',
    ],
    'Report an Issue must expose Other, Audio, Video, and Subtitle in that order'
  );
  requireText(
    createIssue,
    'options={issueTypeOptions}',
    'the Issue Type dropdown must consume the complete required option set'
  );
  requireText(
    createIssue,
    'artwork={backdrop}',
    'caller-provided issue artwork must be passed into the summary card'
  );
  rejectText(
    createIssue,
    'loading={!!detailUrl && !data && !error}\n            backdrop=',
    'Report an Issue must not restore artwork on the outer modal'
  );
  rejectText(
    createIssue,
    '<RadioGroup',
    'Report an Issue must not restore the old radio-button grid'
  );
  rejectText(
    createIssue,
    'subTitle=',
    'Report an Issue must not repeat the media title beneath the heading'
  );
  requireText(
    createIssue,
    'as="textarea"\n                  rows={3}',
    'issue description must use the three-row comment-entry treatment'
  );
  requireText(
    createIssue,
    'flex flex-wrap items-center justify-end gap-2',
    'issue form actions must remain right-aligned'
  );

  const profile = 'src/components/UserProfile/ProfileHeader/index.tsx';
  requireText(
    profile,
    'user.userType === UserType.LOCAL',
    'only local users may upload avatars'
  );
  requireText(
    profile,
    `/api/v1/user/${'${user.id}'}/avatar`,
    'local avatar edit must call the upload route'
  );
  requireText(
    'server/lib/imageproxy.ts',
    'new URL(imagePath, baseUrl || undefined).href',
    'remote Plex avatars must accept an absolute HTTPS URL when no provider base URL exists'
  );
  requireText(
    'server/lib/imageproxy.test.ts',
    'accepts an absolute remote image URL without a configured base URL',
    'absolute Plex avatar URL handling must have regression coverage'
  );
  requireText(
    'src/components/Common/CachedImage/index.tsx',
    'AVATAR_PRELOAD_RETRY_DELAYS_MS',
    'the shared avatar component must retry while a remote Plex avatar cache is being warmed'
  );
  requireText(
    'src/components/Common/CachedImage/index.tsx',
    'retryTimer = setTimeout(preloadAvatar, retryDelay)',
    'remote avatar cache warm-up retries must remain bounded and delayed'
  );

  requireText(
    'src/components/Layout/SearchInput/index.tsx',
    'w-full max-w-2xl min-w-0',
    'the global search control must be wide enough for its complete placeholder'
  );
  requireText(
    'src/hooks/useSearchInput.ts',
    'delete remainingQuery.query;',
    'backspacing search to empty must remove the stale route query'
  );
  requireText(
    'src/hooks/useSearchInput.utils.ts',
    "!(pathname === '/search' && (closingSearch || searchValue === ''))",
    'empty search input must not be repopulated from a stale route value'
  );
  requireText(
    'src/hooks/useSearchInput.test.ts',
    'removes the route query after backspacing the search input to empty',
    'search clearing must have a routing regression test'
  );

  requireText(
    'server/models/Music.ts',
    "source: 'musicbrainz' | 'lidarr';",
    'music rating responses must identify their provider source'
  );
  requireText(
    'server/api/servarr/lidarr.ts',
    'ratings?: LidarrRating;',
    'Lidarr album responses must expose their optional rating metadata'
  );
  requireText(
    'server/routes/music.ts',
    "source: 'musicbrainz'",
    'MusicBrainz must remain the preferred album rating source'
  );
  requireText(
    'server/routes/music.ts',
    "source: 'lidarr'",
    'music rating lookup must fall back to the configured Lidarr album'
  );
  requireText(
    'server/routes/index.ts',
    "router.use('/playback', isAuthenticated(), playbackRoutes);",
    'the playback catalog and command API must be registered in the production server'
  );
  for (const playbackPath of [
    '  /playback/devices:',
    '  /playback/media/{mediaId}:',
    '  /playback/media/{mediaId}/play:',
    '  /playback/media/{mediaId}/playlist:',
    '  /playback/collection/play:',
    '  /playback/collection/playlist:',
  ]) {
    requireText(
      'seerr-api.yml',
      playbackPath,
      'every playback route must be admitted by the production OpenAPI request gate'
    );
  }
  requireText(
    'server/routes/workflow.openapi.test.ts',
    'admits media and collection playlist replacement commands',
    'the playback OpenAPI boundary must have executable regression coverage'
  );
  for (const [fileName, token, description] of [
    [
      'server/routes/playback.ts',
      "const CURRENT_SELECTION_PLAYLIST_NAME = 'SeerrNG - Current Selection'",
      'provider playback must use the one canonical replacement-playlist name',
    ],
    [
      'server/routes/playback.ts',
      'resolvePlaylistItemIds(',
      'both playback actions must validate and canonicalize media selections',
    ],
    [
      'src/components/Common/MediaServerPlayButton/index.tsx',
      "'/api/v1/playback/collection/playlist'",
      'Collection Play on Server must replace the provider playlist',
    ],
    [
      'src/components/Common/MediaServerPlayButton/index.tsx',
      '`/api/v1/playback/media/${mediaId}/playlist`',
      'Media Play on Server must replace the provider playlist',
    ],
    [
      'server/entity/Media.ts',
      'ratingKeyFlac',
      'Plex music must retain a distinct FLAC playback identifier',
    ],
    [
      'server/entity/Media.ts',
      'jellyfinMediaIdFlac',
      'Jellyfin and Emby music must retain a distinct FLAC playback identifier',
    ],
    [
      'server/migration/sqlite/1784800000000-AddAudioPlaybackVariants.ts',
      'ratingKeyFlac',
      'SQLite must migrate the separate audio playback identifiers',
    ],
    [
      'server/migration/postgres/1784800000000-AddAudioPlaybackVariants.ts',
      'ratingKeyFlac',
      'PostgreSQL must migrate the separate audio playback identifiers',
    ],
    [
      'server/lib/playbackMediaRoot.ts',
      'const selectedVariant = is4k ? media.ratingKeyFlac : media.ratingKeyMp3;',
      'Plex music playback must resolve the exact selected MP3 or FLAC identifier',
    ],
    [
      'server/lib/playbackMediaRoot.ts',
      '? media.jellyfinMediaIdFlac\n        : media.jellyfinMediaIdMp3;',
      'Jellyfin and Emby music playback must resolve the exact selected MP3 or FLAC identifier',
    ],
    [
      'server/lib/playbackSelection.test.ts',
      'translates a music selection into only the selected quality catalog',
      'playlist selection must have regression coverage against mixed music qualities',
    ],
    [
      'server/lib/audioPlaybackFormat.test.ts',
      "classifyAudioPlaybackFormats(['audio/mpeg-1-layer-3'])",
      'audio format classification must cover normalized MP3 codec names',
    ],
  ]) {
    requireText(fileName, token, description);
  }
  requireText(
    'package.json',
    'node bin/run-prettier.mjs --check',
    'the GitHub formatting check must use the cross-platform local runner'
  );
  requireText(
    'bin/run-prettier.mjs',
    "path.join(root, 'prettier-scope.txt')",
    'the cross-platform formatter must use a deterministic scope file retained in GitHub source archives'
  );
  requireText(
    'prettier-scope.txt',
    'gen-docs/vendor/image-size/dist/',
    'the formatter must continue excluding the intentionally vendored generated JavaScript'
  );
  requireText(
    'prettier-scope.txt',
    'gen-docs/.docusaurus/',
    'the formatter must exclude generated documentation metadata'
  );
  requireText(
    'prettier-scope.txt',
    'gen-docs/build/',
    'the formatter must exclude rendered documentation output'
  );
  requireText(
    'bin/run-prettier.mjs',
    "    '.',",
    'the cross-platform formatter must let Prettier traverse the repository without command-line path expansion'
  );
  rejectText(
    'bin/run-prettier.mjs',
    "['ls-files', '--cached', '--others', '--exclude-standard', '-z']",
    'the formatting runner must not depend on Git being installed in the GitHub action container'
  );
  rejectText(
    'bin/run-prettier.mjs',
    "    '--cache',",
    'the repository formatting gate must not let a local cache conceal clean-checkout differences'
  );
  requireText(
    'server/lib/localAvatar.ts',
    '!Buffer.isBuffer(input)',
    'local avatar processing must reject runtime type confusion before image decoding'
  );
  requireText(
    'server/lib/localAvatar.ts',
    'getLocalAvatarUserKey(userId)',
    'local avatar filenames must use a fixed-width storage key rather than request data'
  );
  requireText(
    'server/lib/localAvatar.ts',
    'safeVersion !== version',
    'local avatar versions must remain canonical path basenames'
  );
  rejectText(
    'server/lib/localAvatar.ts',
    'new RegExp(',
    'local avatar cleanup must not construct regular expressions from request-derived values'
  );
  requireText(
    'server/routes/user/index.ts',
    'const avatarInput = Buffer.from(req.body);',
    'local avatar uploads must cross the HTTP boundary as a validated Buffer copy'
  );
  requireText(
    'server/routes/avatarproxy.ts',
    'readLocalAvatar(user.id, user.avatarVersion)',
    'local avatar reads must use the persisted user identity after authorization'
  );
  rejectText(
    'server/api/tvdb/index.ts',
    'Failed to find season ${seasonNumber}',
    'TVDB request values must not be interpolated into log messages'
  );
  requireText(
    'server/utils/sessionCookie.test.ts',
    'codeql[js/clear-text-cookie]',
    'the intentional synthetic HTTP-fallback regression must remain explicitly scoped for code scanning'
  );
  requireText(
    '.github/workflows/ci.yml',
    'Install Git for complete checkout',
    'the minimal Alpine validation job must install Git before checkout so export-ignored contract files remain available'
  );
  requireText(
    '.github/workflows/ci.yml',
    'run: apk add --no-cache git',
    'the minimal Alpine validation job must provide Git to actions/checkout'
  );
  requireText(
    'bin/run-cypress-start.mjs',
    "E2E_TESTS: 'true'",
    'the isolated Cypress server must disable production request limits that make the complete browser suite timing-dependent'
  );
  requireText(
    'server/lib/imageproxy.test.ts',
    "const posixIt = process.platform === 'win32' ? it.skip : it",
    'POSIX image-cache boundary tests must remain active in Linux CI without failing ordinary Windows workstations'
  );
  requireText(
    'server/middleware/apiResponseCache.ts',
    "return 'private, no-cache';",
    'discover and search errors must not be hidden by a stale cached empty response'
  );
  requireText(
    'src/components/Discover/DiscoverBooks/index.tsx',
    'responseVersion: 2',
    'book discovery must retire browser cache entries created under the old stale-empty response contract'
  );
  requireText(
    'seerr-api.yml',
    'name: responseVersion',
    'the documented Book discovery API must accept the response contract version'
  );
  rejectText(
    'server/middleware/apiResponseCache.ts',
    "return 'private, no-cache, stale-if-error=3600';",
    'discover and search must surface current provider failures instead of stale empty results'
  );

  const filterPanel = 'src/components/Discover/FilterPanel/index.tsx';
  requireText(
    filterPanel,
    'useDebouncedState(',
    'movie and series keyword search must be live'
  );
  requireText(
    filterPanel,
    'useSearchActivityReporter(',
    'movie and series keyword search must report activity'
  );
  requireOrder(
    filterPanel,
    [
      'const clearAllFilters = () => {',
      "routedSearchRef.current = '';",
      "setSearchValue('');",
      'batchUpdateQueryParams({',
      '...clearedFilters,',
      '[searchQueryKey]: undefined,',
      'onClick={clearAllFilters}',
    ],
    'movie and series Clear Filters must clear both routed and debounced keyword state'
  );
  requireOrder(
    filterPanel,
    [
      'getFilterResetButtonClass(!hasActiveFilters)',
      '<CardTextVisibilityToggle',
      '<AvailabilityQualityControl',
      'className="order-3"',
      'className="order-4 basis-full"',
      '<form',
      'order-5',
    ],
    'movie and series must preserve Clear Filters, Title View, Quality Available, then the Keyword Search row break'
  );
  requireOrder(
    'src/components/Discover/AvailabilityQualityControl/index.tsx',
    [
      '{ label: intl.formatMessage(messages.all) }',
      "{ label: 'MP3', value: 'mp3' }",
      "{ label: 'FLAC', value: 'flac' }",
    ],
    'Music quality filtering must preserve All, MP3, FLAC order'
  );
  requireOrder(
    'src/components/Discover/AvailabilityQualityControl/index.tsx',
    [
      '{ label: intl.formatMessage(messages.all) }',
      "{ label: 'HD', value: 'hd' }",
      "{ label: '4K', value: '4k' }",
    ],
    'Movie and Series quality filtering must preserve All, HD, 4K order'
  );
  requireText(
    'src/utils/availabilityQuality.ts',
    'availableStatuses.has(status)',
    'Discover quality matching must accept only scanned available video states'
  );
  requireText(
    'src/hooks/useDiscover.ts',
    'matchesAvailableQuality(item, availableQuality)',
    'Discover results must enforce the selected scanned availability quality'
  );
  requireText(
    'server/routes/discover.ts',
    'availableQualities',
    'Music discovery must expose separately persisted Lidarr qualities'
  );
  requireText(
    'server/routes/discover.ts',
    'getLiveRadarrMovieAvailability',
    'Movie quality filters must consult current synchronized Radarr libraries'
  );
  requireText(
    'server/routes/discover.ts',
    'if (movie.hasFile && !destination.has(movie.tmdbId))',
    'Movie quality filters must exclude monitored Radarr entries without files'
  );
  requireText(
    'server/routes/discover.ts',
    'const pageTmdbIds = pageItems.map(({ movie }) => movie.tmdbId);',
    'Live Movie filtering must hydrate persisted relationships only after pagination'
  );
  requireText(
    'server/routes/discover.ts',
    'cover?serviceId=${server.id}&externalServiceId=${movie.id}&is4k=${server.is4k}',
    'Live Radarr Movie cards must use the authenticated service-specific cover proxy'
  );
  requireText(
    'server/routes/discover.test.ts',
    'uses current Radarr file state and metadata for quality availability',
    'Live Radarr Movie availability must retain focused route coverage'
  );
  requireText(
    'server/routes/movie.test.ts',
    'serves a live Radarr discovery cover without persisted service links',
    'Live Radarr Movie posters must retain focused cover-proxy coverage'
  );
  requireText(
    'server/routes/movie.ts',
    'candidate.id === explicitServiceId && Boolean(candidate.is4k) === is4k',
    'Live Radarr Movie covers must validate the requested configured service and quality'
  );
  requireText(
    'server/routes/discover.test.ts',
    'exposes every scanned Lidarr quality for discovery filtering',
    'Music discovery quality metadata must have route coverage'
  );
  for (const fileName of [
    'src/components/Discover/DiscoverMusic/index.tsx',
    'src/components/Discover/DiscoverBooks/index.tsx',
  ]) {
    requireText(
      fileName,
      'useDebouncedState(',
      'keyword search must update live'
    );
    requireText(
      fileName,
      'useSearchActivityReporter(',
      'keyword search must report activity'
    );
  }
  requireText(
    'src/components/Discover/DiscoverBooks/index.tsx',
    '{discover.error && (',
    'Books must show a provider error instead of No Results'
  );
  requireOrder(
    'src/components/Discover/BookFormatTabs/index.tsx',
    ["format: 'all'", "format: 'ebook'", "format: 'audiobook'"],
    'Books discovery must preserve the All Books, Books, Audiobooks format order'
  );
  requireText(
    'src/pages/discover/books/index.tsx',
    '<DiscoverBooks format="all" />',
    'Books discovery must default to All Books'
  );
  requireOrder(
    'src/components/Discover/DiscoverBooks/index.tsx',
    [
      'messages.mediaFilters',
      '<BookFormatTabs',
      'messages.filters',
      'getFilterResetButtonClass(!hasActiveFilters)',
      '<CardTextVisibilityToggle',
      '<form',
      'messages.firstPublished',
      'messages.genres',
      'messages.ratingFilter',
      'messages.language',
    ],
    'Books and Audiobooks must separate Media Filters from the continuous regular filter row'
  );
  requireOrder(
    'src/components/Discover/DiscoverMusic/index.tsx',
    [
      'getFilterResetButtonClass(!hasActiveFilters)',
      '<CardTextVisibilityToggle',
      '<AvailabilityQualityControl',
      'className="order-3"',
      'className="order-4 basis-full"',
      '<form',
      'order-5',
    ],
    'Music must preserve Clear Filters, Title View, Quality Available, then the Keyword Search row break'
  );
  requireOrder(
    'src/components/Discover/FilterPanel/index.tsx',
    ['<form', "type === 'tv'", 'messages.status', 'messages.releaseDate'],
    'Series Status must sit immediately after Keyword Search'
  );
  requireText(
    'src/components/Selector/index.tsx',
    'defaultOptions={availableGenreOptions}',
    'the shared Movie and Series genre selector must preload its options'
  );
  requireText(
    'src/components/Selector/genreOptions.test.ts',
    'prepares the complete Series genre list for the default dropdown',
    'Series genre preloading must retain focused regression coverage'
  );
  requireText(
    'src/components/TitleCard/index.tsx',
    "request: '1'",
    'the Book poster-card Request action must navigate to the auto-open Details flow'
  );
  requireText(
    'src/components/BookDetails/index.tsx',
    "router.query.request !== '1'",
    'Book Details must recognize the one-time automatic request-card handoff'
  );
  requireText(
    'src/components/BookDetails/index.tsx',
    'router.replace(',
    'Book Details must consume the automatic-open route state so refresh does not reopen it'
  );
  requireText(
    'server/routes/discover.ts',
    'Open Library returned an empty default discovery feed.',
    'an empty default all-books provider response must surface as a provider failure'
  );
  requireText(
    'server/routes/discover.test.ts',
    'uses one broad query for the default all-books feed',
    'the broad 50-book default feed must have regression coverage'
  );
  requireText(
    'server/routes/discover.test.ts',
    'reports provider failure instead of an empty default book feed',
    'the empty default all-books response must have regression coverage'
  );
  for (const token of [
    'const bookDiscoveryContext = {',
    "? 'audiobook'",
    "? 'book'",
    ": 'all'",
    'keyword: searchQuery || undefined',
    'pageSize: itemsPerPage',
    'sort: sortByValue',
    'genre: subjectQuery || undefined',
    'firstPublishYear: firstPublishYear || undefined',
    'language: language || undefined',
    'minRating: parsedRatingNumber',
    'discoveryContext: bookDiscoveryContext',
  ]) {
    requireText(
      'server/routes/discover.ts',
      token,
      'Books discovery failures must log one sanitized structured request context'
    );
  }
  requireText(
    'server/routes/discover.test.ts',
    'reports one sanitized structured context when Open Library is unavailable',
    'Books discovery structured failure logging must have regression coverage'
  );
  requireText(
    'src/hooks/useUpdateQueryParams.ts',
    ".toString().replace(/\\+/g, '%20')",
    'live keyword routes must percent-encode spaces instead of emitting rejected plus separators'
  );
  requireText(
    'src/hooks/useUpdateQueryParams.test.ts',
    'query=space%20opera%20%26%20fantasy',
    'multi-word keyword route encoding must have regression coverage'
  );
  requireText(
    'src/components/RequestModal/BookRequestModal.tsx',
    'selectedDestinationCovered',
    'Book request submission must be disabled for both available and actively requested formats'
  );
  requireText(
    'src/components/RequestModal/requestAvailability.test.ts',
    'book request coverage blocks only active overlapping formats',
    'Book request overlap handling must preserve complementary-format requests'
  );
  for (const testName of [
    'removes only the ebook link when an audiobook link remains',
    'removes only the audiobook link when an ebook link remains',
    'persists successful book format removals when another format fails',
    'persists audiobook removal when ebook removal fails',
  ]) {
    requireText(
      'server/routes/media.test.ts',
      testName,
      `Book removal matrix is missing ${testName}`
    );
  }
  requireText(
    'server/lib/downloadtracker.test.ts',
    'continues polling remaining configured instances when one fails',
    'download polling must retain multi-instance failure isolation coverage'
  );
  for (const testName of [
    'stores audiobook service data separately from ebook service data',
    'stores ebook service data separately from audiobook service data',
  ]) {
    requireText(
      'server/lib/scanners/readarr/readarr.test.ts',
      testName,
      `Bookshelf reclassification matrix is missing ${testName}`
    );
  }
  requireText(
    'server/routes/discover.ts',
    "toFieldedBooleanAndQuery(searchQuery, ['title', 'author'])",
    'Book provider searches must be limited to visible title and author fields'
  );
  rejectText(
    'server/routes/discover.ts',
    '[doc.title, ...(doc.author_name ?? []), ...(doc.subject ?? [])]',
    'Book keyword relevance must not admit hidden subject-only matches'
  );
  requireText(
    'server/routes/search.ts',
    'query: toFieldedBooleanAndQuery(queryString, [',
    'Global Book searches must use the same visible title and author provider query'
  );
  requireText(
    'server/routes/search.test.ts',
    'limits global book keywords to visible title and author fields',
    'Global Book keyword relevance must have regression coverage'
  );
  const apiSpec = requireFile('seerr-api.yml');
  const tvDiscoverStart = apiSpec.indexOf('  /discover/tv:');
  const tvDiscoverEnd = apiSpec.indexOf(
    '\n  /discover/tv/',
    tvDiscoverStart + 1
  );
  if (
    tvDiscoverStart < 0 ||
    tvDiscoverEnd < 0 ||
    !apiSpec
      .slice(tvDiscoverStart, tvDiscoverEnd)
      .includes('          name: search')
  ) {
    errors.push(
      'seerr-api.yml: Series live keyword search must be accepted by the API contract'
    );
  }
  for (const fileName of [
    'src/components/Discover/DiscoverMovies/index.tsx',
    'src/components/Discover/DiscoverTv/index.tsx',
  ]) {
    requireText(
      fileName,
      'getFilterToggleButtonClass(active)',
      'movie and series sort controls must use the shared Discover button style'
    );
  }
  requireText(
    'src/components/Discover/index.tsx',
    'data-testid="discover-start-editing"',
    'Discover must retain its customization action'
  );
  requireOrder(
    'src/components/Discover/index.tsx',
    ['<Button', 'buttonSize="sm"', 'data-testid="discover-start-editing"'],
    'Discover customization must use the shared compact button'
  );

  requireText(
    'src/components/RequestStatus/index.tsx',
    'grid-cols-[7rem_6rem_7.5rem_minmax(0,1fr)]',
    'Request Status history must keep Date, Time, Action, Description columns'
  );

  const slider = 'src/components/Slider/index.tsx';
  requireText(
    slider,
    "compact ? 'slider-item-compact'",
    'compact card geometry must be applied to items'
  );
  requireText(
    slider,
    "compact ? 'min-h-[5.5rem]'",
    'compact sliders must not reserve poster height'
  );

  const evidence = [
    [
      'src/components/RequestModal/requestAvailability.test.ts',
      'an available FLAC destination does not block an MP3 request',
      'must test FLAC-to-MP3 eligibility',
    ],
    [
      'src/components/RequestModal/requestAvailability.test.ts',
      'an available MP3 destination does not block a FLAC request',
      'must test MP3-to-FLAC eligibility',
    ],
    [
      'src/components/RequestStatus/requestStatusQuery.test.ts',
      'All Users',
      'must test the Request Status manager default',
    ],
    [
      'server/lib/requestStatus.test.ts',
      'music remains importing after its download leaves the queue until Lidarr confirms files',
      'must test the Picard hold stage',
    ],
    [
      'server/lib/requestStatus.test.ts',
      'music reports no release found after Lidarr completes a search with no grab',
      'must test failed Lidarr searches',
    ],
    [
      'server/lib/requestStatus.test.ts',
      'Arr import-pending queue details remain importing instead of failing',
      'must test manual-import holds',
    ],
    [
      'server/lib/downloadtracker.test.ts',
      'finds the newest request-scoped album event after a queue item disappears',
      'must test Lidarr history reconciliation',
    ],
    [
      'server/lib/bookRequestSearch.test.ts',
      'reports importing when a grabbed book has left the live queue',
      'must test Bookshelf manual-import holds',
    ],
    [
      'src/components/IssueDetails/issueMediaFormat.test.ts',
      'issue quality choices include only qualities currently available',
      'must test available HD and 4K issue targets',
    ],
    [
      'src/components/IssueList/IssueItem/issueAffectedSummary.test.ts',
      'reports all seasons when every available season is selected',
      'must test affected-series summaries',
    ],
    [
      'server/routes/discover.test.ts',
      'drops broad movie search results that do not contain every keyword',
      'must test Movie keyword relevance',
    ],
    [
      'server/routes/discover.test.ts',
      'keeps relevant book search order and drops hidden metadata-only matches',
      'must test Book keyword relevance',
    ],
    [
      'server/routes/discover.test.ts',
      'reports when a single Open Library request stalls',
      'must test Books timeout reporting',
    ],
    [
      'server/utils/searchTerms.test.ts',
      'quoted',
      'must test quoted keyword phrases',
    ],
    [
      'server/lib/localAvatar.test.ts',
      'not-a-buffer',
      'must test local avatar runtime type rejection',
    ],
    [
      'server/routes/userAvatar.openapi.test.ts',
      'avatar',
      'must test the local avatar route contract',
    ],
    [
      'server/routes/user.test.ts',
      'persists independent detail disclosure pins per user',
      'must test database-backed detail disclosure pin persistence',
    ],
    [
      'src/hooks/detailDisclosurePinsMutation.test.ts',
      'does not roll back a newer detail disclosure pin mutation',
      'must test stale optimistic pin rollback protection',
    ],
    [
      'server/migration/sqlite/1785000000000-AddDetailDisclosurePins.test.ts',
      'default to unpinned and migrate reversibly',
      'must test the SQLite detail disclosure pin migration',
    ],
    [
      'server/migration/postgres/1785000000000-AddDetailDisclosurePins.test.ts',
      'migrate reversibly',
      'must test the PostgreSQL detail disclosure pin migration contract',
    ],
  ];
  for (const [fileName, text, reason] of evidence) {
    requireText(fileName, text, reason);
  }

  return errors;
};

module.exports = { readRepositoryFiles, validateCurrentBatchContract };
