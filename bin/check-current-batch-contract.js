#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-console -- This validator is a CommonJS command-line tool. */

const path = require('node:path');
const {
  readRepositoryFiles,
  validateCurrentBatchContract,
} = require('./check-current-batch-contract-lib.js');

const root = path.resolve(__dirname, '..');
const fileNames = [
  'docs/maintainers/current-batch-acceptance-ledger.md',
  'docs/maintainers/ui-style-standard.md',
  'package.json',
  'bin/run-prettier.mjs',
  'bin/run-cypress-start.mjs',
  'seerr-api.yml',
  'src/styles/globals.css',
  'src/components/Common/Button/index.tsx',
  'src/components/Common/ButtonWithDropdown/index.tsx',
  'src/components/RequestButton/index.tsx',
  'src/components/MediaDetails/ExpandableCreditList.tsx',
  'src/components/MediaDetails/DetailDisclosureButton.tsx',
  'src/components/MediaDetails/SeriesSeasonEpisodeBrowser.tsx',
  'src/components/MovieDetails/index.tsx',
  'src/components/MovieDetails/MovieDetailsLayout.tsx',
  'src/components/TvDetails/index.tsx',
  'src/components/TvDetails/SeriesDetailsLayout.tsx',
  'src/components/MusicDetails/index.tsx',
  'src/components/MusicDetails/MusicDetailsLayout.tsx',
  'src/components/BookDetails/index.tsx',
  'src/components/BookDetails/BookDetailsLayout.tsx',
  'src/components/RequestModal/MovieRequestModal.tsx',
  'src/components/RequestModal/TvRequestModal.tsx',
  'src/components/RequestModal/MusicRequestModal.tsx',
  'src/components/RequestModal/BookRequestModal.tsx',
  'src/components/RequestModal/AdvancedRequester/index.tsx',
  'src/components/Blocklist/index.tsx',
  'src/components/IssueList/index.tsx',
  'src/components/IssueList/IssueItem/index.tsx',
  'src/components/IssueDetails/index.tsx',
  'src/components/IssueDetails/IssueMediaSummary.tsx',
  'src/components/IssueModal/CreateIssueModal/index.tsx',
  'src/components/IssueModal/constants.ts',
  'src/components/RequestList/index.tsx',
  'src/components/RequestStatus/index.tsx',
  'src/components/Settings/SettingsLogs/index.tsx',
  'src/components/UserList/index.tsx',
  'src/components/UserProfile/ProfileHeader/index.tsx',
  'src/components/Common/CachedImage/index.tsx',
  'src/components/Discover/FilterPanel/index.tsx',
  'src/components/Discover/index.tsx',
  'src/components/Discover/DiscoverMovies/index.tsx',
  'src/components/Discover/DiscoverTv/index.tsx',
  'src/components/Discover/DiscoverMusic/index.tsx',
  'src/components/Discover/DiscoverBooks/index.tsx',
  'src/hooks/useUpdateQueryParams.ts',
  'src/hooks/useUpdateQueryParams.test.ts',
  'src/components/Slider/index.tsx',
  'src/components/RequestModal/RequestMediaCard.tsx',
  'src/components/RequestModal/requestAvailability.test.ts',
  'src/components/RequestStatus/requestStatusQuery.test.ts',
  'src/components/IssueDetails/issueMediaFormat.test.ts',
  'src/components/IssueList/IssueItem/issueAffectedSummary.test.ts',
  'cypress/e2e/movie-details.cy.ts',
  'cypress/e2e/tv-details.cy.ts',
  'server/routes/request.test.ts',
  'server/lib/requestStatus.test.ts',
  'server/lib/bookRequestSearch.test.ts',
  'server/lib/downloadtracker.test.ts',
  'server/lib/scanners/lidarr/lidarr.test.ts',
  'server/routes/discover.test.ts',
  'server/routes/discover.ts',
  'server/routes/search.ts',
  'server/routes/search.test.ts',
  'server/middleware/apiResponseCache.ts',
  'server/middleware/apiResponseCache.test.ts',
  'server/utils/searchTerms.ts',
  'server/api/openlibrary/index.ts',
  'server/utils/searchTerms.test.ts',
  'server/lib/localAvatar.test.ts',
  'server/lib/imageproxy.ts',
  'server/lib/imageproxy.test.ts',
  'server/routes/userAvatar.openapi.test.ts',
];

const errors = validateCurrentBatchContract(
  readRepositoryFiles(root, fileNames)
);

if (errors.length > 0) {
  console.error('Current batch contract check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(
    `Current batch contract check passed (${fileNames.length} files).`
  );
}
