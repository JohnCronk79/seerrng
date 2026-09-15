import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { FilterOptions } from '@app/components/Discover/constants';
import { prepareFilterValues } from '@app/components/Discover/constants';
import FilterPanel from '@app/components/Discover/FilterPanel';
import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import useDiscover from '@app/hooks/useDiscover';
import useDiscoverScrollRestoration from '@app/hooks/useDiscoverScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type { SortOptions as TMDBSortOptions } from '@server/api/themoviedb';
import type { ProductionCompany } from '@server/models/common';
import type { MovieResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMovies', {
  movies: 'Movies',
  filters: 'Filters',
  sortBy: 'Sort By',
  popularity: 'Popularity',
  releaseDate: 'Release Date',
  rating: 'TMDB Rating',
  title: 'Title',
  studioMovies: '{studio} Movies',
});
const sorts: {
  label: keyof typeof messages;
  asc: TMDBSortOptions;
  desc: TMDBSortOptions;
}[] = [
  { label: 'popularity', asc: 'popularity.asc', desc: 'popularity.desc' },
  { label: 'releaseDate', asc: 'release_date.asc', desc: 'release_date.desc' },
  { label: 'rating', asc: 'vote_average.asc', desc: 'vote_average.desc' },
  { label: 'title', asc: 'original_title.asc', desc: 'original_title.desc' },
];

interface DiscoverMoviesProps {
  studio?: ProductionCompany;
}

const DiscoverMovies = ({ studio }: DiscoverMoviesProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const preparedFilters = {
    ...prepareFilterValues(router.query),
    ...(studio ? { studio: studio.id.toString() } : {}),
  };
  const currentSort = preparedFilters.sortBy || 'popularity.desc';
  const discover = useDiscover<MovieResult, unknown, FilterOptions>(
    '/api/v1/discover/movies',
    preparedFilters,
    {
      randomizeOrder: !preparedFilters.sortBy,
      availableQuality: preparedFilters.availability,
      hideAvailable: !preparedFilters.availability,
    }
  );
  useSearchActivityReporter(
    Boolean(preparedFilters.search || preparedFilters.availability) &&
      (discover.isLoadingInitialData ||
        discover.isValidating ||
        discover.isSearchingAvailableQuality),
    'movies-discovery'
  );
  useDiscoverScrollRestoration({
    mediaType: 'movie',
    itemCount: discover.titles.length,
    shuffleSeed: discover.shuffleSeed,
    isLoading: discover.isLoadingInitialData || discover.isLoadingMore,
    isReachingEnd: discover.isReachingEnd,
    fetchMore: discover.fetchMore,
  });
  if (discover.error) return <ErrorPage statusCode={500} />;
  const title = studio
    ? intl.formatMessage(messages.studioMovies, { studio: studio.name })
    : intl.formatMessage(messages.movies);
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {studio?.logoPath && (
          <div className="relative mx-auto my-4 h-20 w-full max-w-sm sm:h-24">
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/original${studio.logoPath}`}
              alt={studio.name}
              className="object-contain"
              fill
            />
          </div>
        )}
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.filters)}
        </div>
        <FilterPanel type="movie" currentFilters={preparedFilters} />
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap gap-2">
          {sorts.map((option) => {
            const active =
              currentSort === option.asc || currentSort === option.desc;
            const ascending = currentSort === option.asc;
            const Icon = ascending ? BarsArrowUpIcon : BarsArrowDownIcon;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updateQueryParams(
                    'sortBy',
                    active && !ascending ? option.asc : option.desc
                  )
                }
                className={getFilterToggleButtonClass(active)}
              >
                {intl.formatMessage(messages[option.label])}
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
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
    </>
  );
};
export default DiscoverMovies;
