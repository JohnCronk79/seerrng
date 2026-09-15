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
import type { TvNetwork } from '@server/models/common';
import type { TvResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverTv', {
  series: 'Series',
  filters: 'Filters',
  sortBy: 'Sort By',
  popularity: 'Popularity',
  firstAirDate: 'First Air Date',
  rating: 'TMDB Rating',
  title: 'Title',
  networkSeries: '{network} Series',
});
const sorts: {
  label: keyof typeof messages;
  asc: TMDBSortOptions;
  desc: TMDBSortOptions;
}[] = [
  { label: 'popularity', asc: 'popularity.asc', desc: 'popularity.desc' },
  {
    label: 'firstAirDate',
    asc: 'first_air_date.asc',
    desc: 'first_air_date.desc',
  },
  { label: 'rating', asc: 'vote_average.asc', desc: 'vote_average.desc' },
  { label: 'title', asc: 'original_title.asc', desc: 'original_title.desc' },
];
interface DiscoverTvProps {
  network?: TvNetwork;
}

const DiscoverTv = ({ network }: DiscoverTvProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const preparedFilters = {
    ...prepareFilterValues(router.query),
    ...(network ? { network: network.id.toString() } : {}),
  };
  const currentSort = preparedFilters.sortBy || 'popularity.desc';
  const discover = useDiscover<TvResult, never, FilterOptions>(
    '/api/v1/discover/tv',
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
    'series-discovery'
  );
  useDiscoverScrollRestoration({
    mediaType: 'tv',
    itemCount: discover.titles.length,
    shuffleSeed: discover.shuffleSeed,
    isLoading: discover.isLoadingInitialData || discover.isLoadingMore,
    isReachingEnd: discover.isReachingEnd,
    fetchMore: discover.fetchMore,
  });
  if (discover.error) return <ErrorPage statusCode={500} />;
  const title = network
    ? intl.formatMessage(messages.networkSeries, { network: network.name })
    : intl.formatMessage(messages.series);
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {network?.logoPath && (
          <div className="relative mx-auto my-4 h-20 w-full max-w-sm sm:h-24">
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/original${network.logoPath}`}
              alt={network.name}
              className="object-contain"
              fill
            />
          </div>
        )}
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.filters)}
        </div>
        <FilterPanel type="tv" currentFilters={preparedFilters} />
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
export default DiscoverTv;
