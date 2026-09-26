import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import RequestModal from '@app/components/RequestModal';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/solid';
import type { MagazineResult } from '@server/models/Magazine';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMagazines', {
  magazines: 'Magazines',
  search: 'Search tracked magazines',
  searchPlaceholder: 'Magazine title',
  unavailable: 'Magazine discovery is unavailable right now.',
  unavailableHint: 'Check the LazyLibrarian connection in service settings.',
  catalogHint:
    'Search magazines tracked by LazyLibrarian, or request another title by name.',
  requestTitle: 'Request “{title}”',
  noResults: 'No tracked magazines match this title.',
});

const DiscoverMagazines = () => {
  const intl = useIntl();
  const router = useRouter();
  const update = useBatchUpdateQueryParams({});
  const { hasPermission } = useUser();
  const query =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const [requestTitle, setRequestTitle] = useState('');
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    routedSearchRef.current = query.trim();
    setSearch(query);
  }, [query, setSearch]);

  const discover = useDiscover<MagazineResult>(
    '/api/v1/discover/magazines',
    { query },
    { showErrorToast: false, hideErrorWithResults: false }
  );
  useSearchActivityReporter(
    Boolean(search.trim()) &&
      (search.trim() !== query.trim() ||
        discover.isLoadingInitialData ||
        discover.isValidating),
    'magazines-keyword'
  );
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();
    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update({ query: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);

  const title = intl.formatMessage(messages.magazines);
  const providerMessage = (
    discover.error as { response?: { data?: { message?: string } } } | undefined
  )?.response?.data?.message;
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MAGAZINE],
    { type: 'or' }
  );

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        <p className="description mt-2">
          {intl.formatMessage(messages.catalogHint)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <form
            className="discover-filter-control w-72 max-w-full flex-none"
            onSubmit={(event) => {
              event.preventDefault();
              const nextSearch = search.trim();
              routedSearchRef.current = nextSearch;
              update({ query: nextSearch || undefined, page: undefined });
            }}
          >
            <span
              className={`discover-filter-control-label gap-1.5 ${
                search.trim() ? 'discover-filter-control-label-active' : ''
              }`}
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={intl.formatMessage(messages.searchPlaceholder)}
              aria-label={intl.formatMessage(messages.search)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </form>
          {canRequest && search.trim() && (
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() => setRequestTitle(search.trim())}
            >
              <PlusIcon />
              <span>
                {intl.formatMessage(messages.requestTitle, {
                  title: search.trim(),
                })}
              </span>
            </Button>
          )}
        </div>
      </div>
      {requestTitle && (
        <RequestModal
          magazineTitle={requestTitle}
          show={true}
          type="magazine"
          onComplete={() => setRequestTitle('')}
          onCancel={() => setRequestTitle('')}
        />
      )}
      {discover.error && (
        <Alert
          title={providerMessage ?? intl.formatMessage(messages.unavailable)}
          type="warning"
        >
          {intl.formatMessage(messages.unavailableHint)}
        </Alert>
      )}
      {!discover.error &&
        !discover.isLoadingInitialData &&
        discover.isEmpty && (
          <Alert title={intl.formatMessage(messages.noResults)} type="info" />
        )}
      {(!discover.error || discover.titles.length > 0) && (
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
      )}
    </>
  );
};

export default DiscoverMagazines;
