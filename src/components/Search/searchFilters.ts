import type { ParsedUrlQuery } from 'querystring';

export type SearchFilterCategory =
  | 'all'
  | 'movie'
  | 'tv'
  | 'book'
  | 'audiobook'
  | 'music';

export const searchContextualFilterKeys = [
  'availability',
  'certification',
  'certificationCountry',
  'certificationGte',
  'certificationLte',
  'certificationMode',
  'country',
  'excludeKeywords',
  'firstAirDateGte',
  'firstAirDateLte',
  'firstPublishYear',
  'genre',
  'language',
  'keywords',
  'minRating',
  'network',
  'primaryReleaseDateGte',
  'primaryReleaseDateLte',
  'releaseType',
  'resultFilter',
  'search',
  'sortBy',
  'status',
  'studio',
  'subject',
  'voteAverageGte',
  'voteAverageLte',
  'watchProviders',
  'watchRegion',
  'withRuntimeGte',
  'withRuntimeLte',
] as const;

export const matchesSearchResultFilter = (
  values: (string | undefined)[],
  filter: string
): boolean => {
  const normalizedFilter = filter.trim().toLocaleLowerCase();

  if (!normalizedFilter) {
    return true;
  }

  return values.some((value) =>
    value?.toLocaleLowerCase().includes(normalizedFilter)
  );
};

export const getSearchResultFilter = (query: ParsedUrlQuery): string =>
  typeof query.resultFilter === 'string' ? query.resultFilter : '';

export const getSearchEndpoint = (
  category: SearchFilterCategory,
  mainQuery = ''
): string => {
  // A populated top search owns the provider request. Media type and contextual
  // keyword controls narrow that search; they must not replace it with a broad
  // discovery feed.
  if (mainQuery.trim()) {
    return '/api/v1/search';
  }

  if (category === 'movie') {
    return '/api/v1/discover/movies';
  }

  if (category === 'tv') {
    return '/api/v1/discover/tv';
  }

  if (category === 'music') {
    return '/api/v1/discover/music';
  }

  if (category === 'book' || category === 'audiobook') {
    return '/api/v1/discover/books';
  }

  return '/api/v1/search';
};

export const isSearchDataReady = ({
  routerReady,
  category,
  query,
}: {
  routerReady: boolean;
  category: SearchFilterCategory;
  query: string;
}): boolean => routerReady && (category !== 'all' || Boolean(query));

export const getSearchCategoryQuery = (
  currentQuery: ParsedUrlQuery,
  category: { type?: string; format?: 'ebook' | 'audiobook' }
): ParsedUrlQuery => {
  const nextQuery = { ...currentQuery };

  searchContextualFilterKeys.forEach((key) => {
    delete nextQuery[key];
  });
  delete nextQuery.format;
  delete nextQuery.order;
  delete nextQuery.sort;

  if (category.type) {
    nextQuery.type = category.type;
  } else {
    delete nextQuery.type;
  }

  if (category.format) {
    nextQuery.format = category.format;
  }

  return nextQuery;
};
