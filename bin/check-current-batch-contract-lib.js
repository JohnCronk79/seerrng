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
    'Task-capture rule: a message prefixed with `feature:`, `bug:`, or `issue:`',
    'must preserve the tagged-prompt capture rule'
  );
  requireText(
    ledger,
    'Status: Future feature, explicitly deferred by the user',
    'must keep the music artist refresh deferred'
  );
  requireText(
    ledger,
    'Every item above must be classified as verified, corrected, intentionally deferred',
    'must retain the exact final acceptance rule'
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

  const globals = 'src/styles/globals.css';
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
    '.refreshed-card-surface {\n    background-color: rgb(var(--color-gray-800) / 0.2)',
    'refreshed cards must use the translucent surface standard'
  );
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
    rejectText(
      fileName,
      'PlayButton',
      'Play on Plex/media-server was removed from detail pages'
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
    'className="detail-disclosure-button"',
    'detail disclosure controls must consume one shared style'
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
      'refreshed-card-surface relative overflow-hidden',
      'artwork must live inside the main card'
    );
    requireText(
      fileName,
      'className="refreshed-artwork-scrim"',
      'artwork must use the shared scrim'
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

  const musicLayout = 'src/components/MusicDetails/MusicDetailsLayout.tsx';
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
  requireOrder(
    musicLayout,
    ['qualityLabels.map', '<Badge', 'messages.available'],
    'MP3/FLAC badges must be immediately left of Available'
  );
  requireText(
    musicLayout,
    '<AlbumTrackList tracks={data.tracks} twoColumnsOnly />',
    'music details must use the two-column track layout'
  );

  const seriesLayout = 'src/components/TvDetails/SeriesDetailsLayout.tsx';
  rejectText(
    seriesLayout,
    'ImdbLogo',
    'must not mislabel an unidentified Series rating as IMDb'
  );
  requireText(
    seriesLayout,
    '<SeriesSeasonEpisodeBrowser tvId={data.id} seasons={visibleSeasons} />',
    'series details must use the read-only season and episode browser'
  );
  const seriesBrowser =
    'src/components/MediaDetails/SeriesSeasonEpisodeBrowser.tsx';
  rejectText(
    seriesBrowser,
    'type="checkbox"',
    'series detail season/episode rows are informational only'
  );

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
      'request status must sit beside Advanced Options'
    );
    requireText(
      fileName,
      'selectedDestinationAvailable',
      'must evaluate selected service/quality availability'
    );
    requireText(
      fileName,
      'disabled={',
      'must disable an unavailable duplicate destination'
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
    'relative inline-flex h-[22px]',
    'Requested By must retain the fixed-height flex alignment standard'
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

  const issueDetails = 'src/components/IssueDetails/index.tsx';
  requireOrder(
    issueDetails,
    ['onClick={leaveIssue}', 'messages.exit', 'messages.closeissue'],
    'Exit and Close Issue must retain their swapped placement'
  );
  requireText(
    'src/components/IssueList/IssueItem/index.tsx',
    'border-emerald-600/80',
    'View Issue must be green'
  );
  requireText(
    'src/components/IssueModal/CreateIssueModal/index.tsx',
    'getAvailableIssueQualities(data?.mediaInfo)',
    'issue quality choices must reflect current HD/4K availability'
  );
  const issueSummary = 'src/components/IssueDetails/IssueMediaSummary.tsx';
  requireText(
    issueSummary,
    'refreshed-card-surface relative rounded-xl',
    'issue artwork must be contained by the complete summary card'
  );
  requireText(
    issueSummary,
    'pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl',
    'issue artwork must be clipped independently inside the card'
  );
  requireText(
    issueSummary,
    'className="refreshed-artwork-scrim"',
    'issue artwork must use the shared readability scrim'
  );
  requireText(
    issueSummary,
    'className="refreshed-artwork-gradient"',
    'issue artwork must use the shared horizontal gradient'
  );
  requireText(
    issueSummary,
    '<div className="relative z-10">',
    'issue summary content must remain above its artwork'
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
    'package.json',
    'node bin/run-prettier.mjs --check',
    'the GitHub formatting check must use the cross-platform local runner'
  );
  requireText(
    'bin/run-prettier.mjs',
    "['ls-files', '--cached', '--others', '--exclude-standard', '-z']",
    'the cross-platform formatter must cover tracked and newly created repository files'
  );
  requireText(
    'bin/run-prettier.mjs',
    '.filter((file) => existsSync(path.join(root, file)))',
    'the cross-platform formatter must ignore tracked files deleted by the current change'
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
      'avatar',
      'must test local avatar persistence',
    ],
    [
      'server/routes/userAvatar.openapi.test.ts',
      'avatar',
      'must test the local avatar route contract',
    ],
  ];
  for (const [fileName, text, reason] of evidence) {
    requireText(fileName, text, reason);
  }

  return errors;
};

module.exports = { readRepositoryFiles, validateCurrentBatchContract };
