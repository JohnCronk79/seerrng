import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import {
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { musicSortOptions } from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import PlaylistImportModal from '@app/components/RequestModal/PlaylistImportModal';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import {
  BarsArrowDownIcon,
  BarsArrowUpIcon,
  MagnifyingGlassIcon,
  QueueListIcon,
} from '@heroicons/react/24/solid';
import type { PlaylistResolutionResponse } from '@server/interfaces/api/playlistInterfaces';
import type { AlbumResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  filters: 'Filters',
  sortBy: 'Sort By',
  search: 'Keyword Search',
  searchMusic: 'Search Music',
  clearFilters: 'Clear Filters',
  genres: 'Genres',
  releaseType: 'Release Type',
  releaseYear: 'Release Year',
  any: 'Any',
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  recommended: 'Recommended',
  week: 'Popular This Week',
  month: 'Popular This Month',
  year: 'Popular This Year',
  listened: 'Most Listened',
  releaseDate: 'Release Date',
  loadError: 'Music discovery could not be loaded right now.',
  importPlaylist: 'Import Playlist',
});
const genres = [
  'Alternative',
  'Classical',
  'Country',
  'Electronic',
  'Hip-Hop',
  'Jazz',
  'Metal',
  'Pop',
  'Rock',
];
const DiscoverMusic = () => {
  const intl = useIntl();
  const router = useRouter();
  const update = useBatchUpdateQueryParams({});
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    routedSearchRef.current = query.trim();
    setSearch(query);
  }, [query, setSearch]);
  const genre =
    typeof router.query.genre === 'string' ? router.query.genre : '';
  const releaseType =
    typeof router.query.releaseType === 'string'
      ? router.query.releaseType
      : '';
  const releaseDateGte =
    typeof router.query.primaryReleaseDateGte === 'string'
      ? router.query.primaryReleaseDateGte
      : '';
  const releaseDateLte =
    typeof router.query.primaryReleaseDateLte === 'string'
      ? router.query.primaryReleaseDateLte
      : '';
  const sortBy =
    typeof router.query.sortBy === 'string' &&
    musicSortOptions.has(router.query.sortBy)
      ? router.query.sortBy
      : 'ranked';
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);
  const [showPlaylistRequests, setShowPlaylistRequests] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistResolutionResponse>();
  const discover = useDiscover<AlbumResult>(
    '/api/v1/discover/music',
    {
      query,
      days: '14',
      sortBy,
      genre,
      releaseType,
      primaryReleaseDateGte: releaseDateGte,
      primaryReleaseDateLte: releaseDateLte,
    },
    { randomizeOrder: !query && sortBy === 'ranked' }
  );
  useSearchActivityReporter(
    Boolean(search.trim()) &&
      (search.trim() !== query.trim() ||
        discover.isLoadingInitialData ||
        discover.isValidating),
    'music-keyword'
  );
  const title = intl.formatMessage(messages.music);
  const setParam = (values: Record<string, string | undefined>) =>
    update({ ...values, page: undefined });
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();

    if (nextSearch !== routedSearchRef.current) {
      update({ query: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);
  const currentYear = new Date().getFullYear();
  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...Array.from({ length: currentYear - 1969 }, (_, index) => {
      const year = currentYear - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const releaseYear =
    !releaseDateGte && !releaseDateLte
      ? 'any'
      : !releaseDateGte && releaseDateLte === '1969-12-31'
        ? 'before-1970'
        : releaseDateGte.endsWith('-01-01') &&
            releaseDateLte === `${releaseDateGte.slice(0, 4)}-12-31`
          ? releaseDateGte.slice(0, 4)
          : 'any';
  const genreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...genres.map((value) => ({ label: value, value: value.toLowerCase() })),
  ];
  const releaseTypeOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    { label: intl.formatMessage(messages.album), value: 'Album' },
    { label: intl.formatMessage(messages.ep), value: 'EP' },
    { label: intl.formatMessage(messages.single), value: 'Single' },
  ];
  const hasActiveFilters = Boolean(
    query || genre || releaseType || releaseDateGte || releaseDateLte
  );
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Header>{title}</Header>
          <div className="flex gap-2">
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() => setShowPlaylistImport(true)}
            >
              <QueueListIcon />
              {intl.formatMessage(messages.importPlaylist)}
            </Button>
          </div>
        </div>
        <div className="mb-2 mt-4 text-sm text-gray-300">
          {intl.formatMessage(messages.filters)}
        </div>
        <div className="flex flex-wrap gap-2">
          <CardTextVisibilityToggle mediaType="album" className="order-2" />
          <button
            type="button"
            aria-pressed={!hasActiveFilters}
            onClick={() => {
              setSearch('');
              setParam({
                query: undefined,
                genre: undefined,
                releaseType: undefined,
                primaryReleaseDateGte: undefined,
                primaryReleaseDateLte: undefined,
              });
            }}
            className={`${getFilterResetButtonClass(!hasActiveFilters)} order-1`}
          >
            {intl.formatMessage(messages.clearFilters)}
          </button>
          <form
            className="order-3 inline-flex h-8 w-72 max-w-full flex-none overflow-hidden rounded-md border border-gray-600 bg-gray-900/70"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ query: search.trim() || undefined });
            }}
          >
            <span
              className={`inline-flex flex-shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-l-[5px] border-r border-gray-600 px-1.5 text-xs font-semibold text-indigo-100 transition-colors ${
                search.trim() ? 'bg-indigo-500/35 text-white' : ''
              }`}
            >
              <MagnifyingGlassIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={intl.formatMessage(messages.searchMusic)}
              aria-label={intl.formatMessage(messages.searchMusic)}
              className="min-w-0 flex-1 border-0 bg-gray-900/70 px-2 py-1 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
            />
          </form>
          <CompactSelect
            className="order-6"
            label={intl.formatMessage(messages.genres)}
            value={genre}
            options={genreOptions}
            onChange={(value) => setParam({ genre: value || undefined })}
          />
          <CompactSelect
            className="order-5"
            label={intl.formatMessage(messages.releaseType)}
            value={releaseType}
            options={releaseTypeOptions}
            onChange={(value) => setParam({ releaseType: value || undefined })}
          />
          <CompactSelect
            className="order-4"
            label={intl.formatMessage(messages.releaseYear)}
            value={releaseYear}
            options={yearOptions}
            onChange={(value) => {
              if (value === 'any') {
                setParam({
                  primaryReleaseDateGte: undefined,
                  primaryReleaseDateLte: undefined,
                });
              } else if (value === 'before-1970') {
                setParam({
                  primaryReleaseDateGte: undefined,
                  primaryReleaseDateLte: '1969-12-31',
                });
              } else {
                setParam({
                  primaryReleaseDateGte: `${value}-01-01`,
                  primaryReleaseDateLte: `${value}-12-31`,
                });
              }
            }}
          />
        </div>
        <div className="mb-2 mt-4 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['ranked', messages.recommended],
              ['popular.week', messages.week],
              ['popular.month', messages.month],
              ['popular.year', messages.year],
              ['listen_count.desc', messages.listened],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={getFilterToggleButtonClass(sortBy === value)}
              onClick={() => setParam({ sortBy: value })}
            >
              {intl.formatMessage(label)}
              <BarsArrowDownIcon className="h-4 w-4" />
            </button>
          ))}
          <button
            className={getFilterToggleButtonClass(
              sortBy.startsWith('release_date')
            )}
            onClick={() =>
              setParam({
                sortBy:
                  sortBy === 'release_date.desc'
                    ? 'release_date.asc'
                    : 'release_date.desc',
              })
            }
          >
            {intl.formatMessage(messages.releaseDate)}
            {sortBy === 'release_date.asc' ? (
              <BarsArrowUpIcon className="h-4 w-4" />
            ) : (
              <BarsArrowDownIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {discover.error &&
        !discover.titles.length &&
        !discover.isLoadingInitialData && (
          <Alert
            title={intl.formatMessage(messages.loadError)}
            type="warning"
          />
        )}
      <ListView
        items={discover.titles}
        isEmpty={discover.isEmpty}
        isLoading={
          discover.isLoadingInitialData ||
          (discover.isLoadingMore && discover.titles.length > 0)
        }
        isReachingEnd={discover.isReachingEnd}
        onScrollBottom={discover.fetchMore}
      />
      {showPlaylistImport && (
        <PlaylistImportModal
          show
          onCancel={() => setShowPlaylistImport(false)}
          onResolved={(response) => {
            setPlaylist(response);
            setShowPlaylistImport(false);
            setShowPlaylistRequests(true);
          }}
        />
      )}
      {playlist && (
        <BulkRequestModal
          show={showPlaylistRequests}
          mediaType="music"
          title={playlist.name}
          initialItems={playlist.items}
          initialTotalItems={playlist.items.length}
          sourceUrl={playlist.url}
          onCancel={() => setShowPlaylistRequests(false)}
        />
      )}
    </>
  );
};
export default DiscoverMusic;
