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
      className="mt-5 flex items-center justify-between"
      aria-label={intl.formatMessage(messages.pagination)}
    >
      <Button
        disabled={page <= 1}
        buttonSize="sm"
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeftIcon className="mr-1 h-4 w-4" aria-hidden="true" />
        {intl.formatMessage(globalMessages.previous)}
      </Button>
      <div className="flex items-center gap-2">
        <label className="inline-flex h-8 overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
          <span
            className={`inline-flex items-center rounded-l-[5px] border-r border-gray-600 px-1.5 text-xs font-semibold text-indigo-100 transition-colors ${
              pageSize !== defaultPageSize ? 'bg-indigo-500/35 text-white' : ''
            }`}
          >
            {intl.formatMessage(messages.resultsPerPage)}
          </span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="border-0 bg-gray-900/70 px-1.5 py-1 text-xs text-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-gray-400">
          {intl.formatMessage(messages.page, {
            page,
            pages: normalizedTotalPages,
          })}
        </span>
      </div>
      <Button
        disabled={page >= normalizedTotalPages}
        buttonSize="sm"
        onClick={() => onPageChange(page + 1)}
      >
        {intl.formatMessage(globalMessages.next)}
        <ChevronRightIcon className="ml-1 h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  );
};

export default PaginationFooter;
