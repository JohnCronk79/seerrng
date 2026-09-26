import Button from '@app/components/Common/Button';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.PaginationFooter', {
  pagination: 'Pagination',
  resultsPerPage: 'Results Per Page',
  page: 'Page {page} of {pages}',
});

interface PaginationFooterProps {
  defaultPageSize?: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
}

const PaginationFooter = ({
  defaultPageSize = 10,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationFooterProps) => {
  const intl = useIntl();
  const normalizedTotalPages = Math.max(totalPages, 1);

  return (
    <nav
      className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
      aria-label={intl.formatMessage(messages.pagination)}
    >
      <label className="discover-filter-control h-8 w-max">
        <span
          className={`discover-filter-control-label ${
            pageSize !== defaultPageSize
              ? 'discover-filter-control-label-active'
              : ''
          }`}
        >
          {intl.formatMessage(messages.resultsPerPage)}
        </span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="border-0 bg-transparent px-1.5 py-1 text-xs text-gray-300 focus:ring-0"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span className="justify-self-center text-sm whitespace-nowrap text-gray-400">
        {intl.formatMessage(messages.page, {
          page,
          pages: normalizedTotalPages,
        })}
      </span>
      <div className="flex gap-2 justify-self-end">
        <Button
          disabled={page <= 1}
          buttonSize="sm"
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(globalMessages.previous)}
        </Button>
        <Button
          disabled={page >= normalizedTotalPages}
          buttonSize="sm"
          onClick={() => onPageChange(page + 1)}
        >
          {intl.formatMessage(globalMessages.next)}
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};

export default PaginationFooter;
