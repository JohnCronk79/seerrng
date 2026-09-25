import FilterPanel from '@app/components/Discover/FilterPanel';
import {
  CompactRatingSelect,
  CompactSelect,
  type CompactSelectOption,
  type RatingOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import {
  BOOK_GENRES,
  BOOK_LANGUAGES,
} from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import { prepareFilterValues } from '@app/components/Discover/constants';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';

import {
  getSearchResultFilter,
  type SearchFilterCategory,
} from './searchFilters';

const messages = defineMessages('components.Search.ContextualFilters', {
  keywordSearch: 'Keyword Search',
  searchAll: 'Search All Media',
  searchBooks: 'Search Books',
  searchAudiobooks: 'Search Audiobooks',
  searchMusic: 'Search Music',
  searchComics: 'Filter Comic Results',
  searchMagazines: 'Filter Magazine Results',
  searchAuthors: 'Search Authors',
  firstPublished: 'First Published',
  genres: 'Genres',
  rating: 'Rating',
  language: 'Language',
  releaseYear: 'Release Year',
  releaseType: 'Release Type',
  any: 'Any',
  album: 'Album',
  ep: 'EP',
  single: 'Single',
});

const musicGenres = [
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

const getQueryString = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : '';

const LibrarySearchFilters = ({
  category,
  filterQuery,
}: {
  category: Exclude<SearchFilterCategory, 'movie' | 'tv'>;
  filterQuery: string;
}) => {
  const intl = useIntl();
  const router = useRouter();
  const update = useBatchUpdateQueryParams({});
  const [search, debouncedSearch, setSearch] = useDebouncedState(filterQuery);
  const routedSearchRef = useRef(filterQuery.trim());

  useEffect(() => {
    routedSearchRef.current = filterQuery.trim();
    setSearch(filterQuery);
  }, [filterQuery, setSearch]);

  useEffect(() => {
    const nextSearch = debouncedSearch.trim();

    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update({ resultFilter: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);

  useSearchActivityReporter(
    Boolean(search.trim()) && search.trim() !== filterQuery.trim(),
    'main-search-keyword-input'
  );

  const setParam = (values: Record<string, string | undefined>) =>
    update({ ...values, page: undefined });
  const currentYear = new Date().getFullYear();
  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: currentYear - 1969 }, (_, index) => {
      const year = currentYear - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const subject = getQueryString(router.query.subject);
  const firstPublishYear = getQueryString(router.query.firstPublishYear);
  const language = getQueryString(router.query.language);
  const minRating = getQueryString(router.query.minRating);
  const genre = getQueryString(router.query.genre);
  const releaseType = getQueryString(router.query.releaseType);
  const releaseDateGte = getQueryString(router.query.primaryReleaseDateGte);
  const releaseDateLte = getQueryString(router.query.primaryReleaseDateLte);
  const releaseYear =
    !releaseDateGte && !releaseDateLte
      ? ''
      : !releaseDateGte && releaseDateLte === '1969-12-31'
        ? 'before-1970'
        : releaseDateGte.endsWith('-01-01') &&
            releaseDateLte === `${releaseDateGte.slice(0, 4)}-12-31`
          ? releaseDateGte.slice(0, 4)
          : '';
  const bookGenreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_GENRES.map(([value, label]) => ({ value, label })),
  ];
  const languageOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_LANGUAGES.map(([value, label]) => ({ value, label })),
  ];
  const ratingOptions: RatingOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: 9 }, (_, index) => {
      const score = 1 + index * 0.5;
      return {
        label: `${score.toFixed(1)}+`,
        value: score.toFixed(1),
        score,
      };
    }),
  ];
  const musicGenreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...musicGenres.map((value) => ({
      label: value,
      value: value.toLowerCase(),
    })),
  ];
  const releaseTypeOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    { label: intl.formatMessage(messages.album), value: 'Album' },
    { label: intl.formatMessage(messages.ep), value: 'EP' },
    { label: intl.formatMessage(messages.single), value: 'Single' },
  ];
  const placeholderMessage =
    category === 'all'
      ? messages.searchAll
      : category === 'book'
        ? messages.searchBooks
        : category === 'audiobook'
          ? messages.searchAudiobooks
          : category === 'author'
            ? messages.searchAuthors
            : category === 'comic'
              ? messages.searchComics
              : category === 'magazine'
                ? messages.searchMagazines
                : messages.searchMusic;

  return (
    <div className="contents">
      <form
        className="discover-filter-control w-72 max-w-full flex-none"
        onSubmit={(event) => {
          event.preventDefault();
          setParam({ resultFilter: search.trim() || undefined });
        }}
      >
        <span
          className={`discover-filter-control-label gap-1.5 ${
            search.trim() ? 'discover-filter-control-label-active' : ''
          }`}
        >
          <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.keywordSearch)}
        </span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={intl.formatMessage(placeholderMessage)}
          aria-label={intl.formatMessage(placeholderMessage)}
          className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
        />
      </form>
      {(category === 'book' || category === 'audiobook') && (
        <>
          <CompactSelect
            label={intl.formatMessage(messages.firstPublished)}
            value={firstPublishYear}
            options={yearOptions}
            onChange={(value) =>
              setParam({ firstPublishYear: value || undefined })
            }
          />
          <CompactSelect
            label={intl.formatMessage(messages.genres)}
            value={subject}
            options={bookGenreOptions}
            onChange={(value) => setParam({ subject: value || undefined })}
          />
          <CompactRatingSelect
            label={intl.formatMessage(messages.rating)}
            value={minRating}
            options={ratingOptions}
            maxScore={5}
            onChange={(value) => setParam({ minRating: value || undefined })}
          />
          <CompactSelect
            label={intl.formatMessage(messages.language)}
            value={language}
            options={languageOptions}
            onChange={(value) => setParam({ language: value || undefined })}
          />
        </>
      )}
      {category === 'music' && (
        <>
          <CompactSelect
            label={intl.formatMessage(messages.releaseYear)}
            value={releaseYear}
            options={yearOptions}
            onChange={(value) => {
              if (!value) {
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
          <CompactSelect
            label={intl.formatMessage(messages.releaseType)}
            value={releaseType}
            options={releaseTypeOptions}
            onChange={(value) => setParam({ releaseType: value || undefined })}
          />
          <CompactSelect
            label={intl.formatMessage(messages.genres)}
            value={genre}
            options={musicGenreOptions}
            onChange={(value) => setParam({ genre: value || undefined })}
          />
        </>
      )}
    </div>
  );
};

const ContextualSearchFilters = ({
  category,
}: {
  category: SearchFilterCategory;
}) => {
  const router = useRouter();
  const filterQuery = getSearchResultFilter(router.query);

  if (category === 'movie' || category === 'tv') {
    const currentFilters = prepareFilterValues({
      ...router.query,
      search: filterQuery || undefined,
    });

    return (
      <FilterPanel
        type={category}
        currentFilters={currentFilters}
        variant="search"
        searchQueryKey="resultFilter"
      />
    );
  }

  return <LibrarySearchFilters category={category} filterQuery={filterQuery} />;
};

export default ContextualSearchFilters;
