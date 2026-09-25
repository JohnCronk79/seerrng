import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import AvailabilityQualityControl, {
  type AvailabilityQuality,
} from '@app/components/Discover/AvailabilityQualityControl';
import {
  FilterResetButton,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import LibraryFilterFields from '@app/components/Discover/FilterPanel/LibraryFilterFields';
import { musicSortOptions } from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import PinnedFilterSection from '@app/components/Discover/PinnedFilterSection';
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
  QueueListIcon,
} from '@heroicons/react/24/solid';
import type { PlaylistResolutionResponse } from '@server/interfaces/api/playlistInterfaces';
import type { AlbumResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  filters: 'Filters',
  sortBy: 'Sort By',
  clearFilters: 'Clear Filters',
  recommended: 'Recommended',
  week: 'Popular This Week',
  month: 'Popular This Month',
  year: 'Popular This Year',
  listened: 'Most Listened',
  releaseDate: 'Release Date',
  loadError: 'Music discovery could not be loaded right now.',
  importPlaylist: 'Import Playlist',
});
const musicSorts = [
  { label: messages.recommended, asc: 'ranked.asc', desc: 'ranked' },
  {
    label: messages.week,
    asc: 'popular.week.asc',
    desc: 'popular.week',
  },
  {
    label: messages.month,
    asc: 'popular.month.asc',
    desc: 'popular.month',
  },
  {
    label: messages.year,
    asc: 'popular.year.asc',
    desc: 'popular.year',
  },
  {
    label: messages.listened,
    asc: 'listen_count.asc',
    desc: 'listen_count.desc',
  },
  {
    label: messages.releaseDate,
    asc: 'release_date.asc',
    desc: 'release_date.desc',
  },
] as const;
interface DiscoverMusicProps {
  titleOverride?: string;
  mediaFilters?: ReactNode;
}

const DiscoverMusic = ({
  titleOverride,
  mediaFilters,
}: DiscoverMusicProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const update = useBatchUpdateQueryParams({});
  const query =
    typeof router.query.search === 'string' ? router.query.search : '';
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    const routedSearch = query.trim();
    if (routedSearch !== routedSearchRef.current) {
      routedSearchRef.current = routedSearch;
      setSearch(query);
    }
  }, [query, setSearch]);
  const genre =
    typeof router.query.genre === 'string' ? router.query.genre : '';
  const artist =
    typeof router.query.artist === 'string' ? router.query.artist : '';
  const availability: AvailabilityQuality | undefined =
    router.query.availability === 'mp3' || router.query.availability === 'flac'
      ? router.query.availability
      : undefined;
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
      availability,
      days: '14',
      sortBy,
      genre,
      artist,
      artistId:
        typeof router.query.artistId === 'string' ? router.query.artistId : '',
      releaseType,
      primaryReleaseDateGte: releaseDateGte,
      primaryReleaseDateLte: releaseDateLte,
    },
    {
      randomizeOrder: !query && !artist && sortBy === 'ranked',
      availableQuality: availability,
      hideAvailable: !availability,
    }
  );
  useSearchActivityReporter(
    search.trim() !== query.trim() ||
      discover.isLoadingInitialData ||
      discover.isLoadingMore ||
      discover.isValidating ||
      discover.isSearchingAvailableQuality,
    'music-discovery'
  );
  const title = titleOverride ?? intl.formatMessage(messages.music);
  const setParam = (values: Record<string, string | undefined>) =>
    update({ ...values, page: undefined });
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();

    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update(
        { search: nextSearch || undefined, page: undefined },
        { shallow: true, scroll: false }
      );
    }
  }, [debouncedSearch, update]);
  const releaseYear =
    !releaseDateGte && !releaseDateLte
      ? 'any'
      : !releaseDateGte && releaseDateLte === '1969-12-31'
        ? 'before-1970'
        : releaseDateGte.endsWith('-01-01') &&
            releaseDateLte === `${releaseDateGte.slice(0, 4)}-12-31`
          ? releaseDateGte.slice(0, 4)
          : 'any';
  const hasActiveFilters = Boolean(
    query ||
    artist ||
    availability ||
    genre ||
    releaseType ||
    releaseDateGte ||
    releaseDateLte ||
    sortBy !== 'ranked'
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
        {mediaFilters}
        <PinnedFilterSection
          mediaType="music"
          section="filters"
          label={intl.formatMessage(messages.filters)}
        >
          <div className="discover-filter-primary-row">
            <FilterResetButton
              label={intl.formatMessage(messages.clearFilters)}
              selected={!hasActiveFilters}
              onClick={() => {
                setSearch('');
                setParam({
                  search: undefined,
                  artist: undefined,
                  artistId: undefined,
                  availability: undefined,
                  genre: undefined,
                  releaseType: undefined,
                  primaryReleaseDateGte: undefined,
                  primaryReleaseDateLte: undefined,
                  sortBy: undefined,
                });
              }}
              className="order-1"
            />
            <CardTextVisibilityToggle mediaType="album" className="order-2" />
            <AvailabilityQualityControl
              mediaType="music"
              value={availability}
              onChange={(value) => setParam({ availability: value })}
              className="order-3"
            />
          </div>
          <div className="discover-filter-secondary-row">
            <LibraryFilterFields
              mediaType="music"
              search={search}
              onSearchChange={setSearch}
              onSearchSubmit={() => {
                const nextSearch = search.trim();
                routedSearchRef.current = nextSearch;
                update(
                  { search: nextSearch || undefined, page: undefined },
                  { shallow: true, scroll: false }
                );
              }}
              genre={genre}
              releaseType={releaseType}
              releaseYear={releaseYear}
              setParam={setParam}
            />
          </div>
        </PinnedFilterSection>
        <PinnedFilterSection
          mediaType="music"
          section="sortBy"
          label={intl.formatMessage(messages.sortBy)}
        >
          <div className="flex flex-wrap gap-2">
            {musicSorts.map((option) => {
              const active = sortBy === option.asc || sortBy === option.desc;
              const ascending = sortBy === option.asc;
              const Icon = ascending ? BarsArrowUpIcon : BarsArrowDownIcon;

              return (
                <button
                  key={option.desc}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setParam({
                      sortBy: active && !ascending ? option.asc : option.desc,
                    })
                  }
                  className={getFilterToggleButtonClass(active)}
                >
                  {intl.formatMessage(option.label)}
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </PinnedFilterSection>
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
          discover.isSearchingAvailableQuality ||
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
