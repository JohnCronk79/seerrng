import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import defineMessages from '@app/utils/defineMessages';
import {
  BookOpenIcon,
  SpeakerWaveIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ParsedUrlQuery } from 'querystring';
import { useIntl } from 'react-intl';

export type BookDiscoveryFormat = 'all' | 'ebook' | 'audiobook';

interface BookFormatTabsProps {
  format: BookDiscoveryFormat;
  query: ParsedUrlQuery;
  className?: string;
}

const messages = defineMessages('components.Discover.BookFormatTabs', {
  format: 'Book format',
  allBooks: 'All Books',
  books: 'Books',
  audiobooks: 'Audiobooks',
});

const BookFormatTabs = ({
  format,
  query,
  className = '',
}: BookFormatTabsProps) => {
  const intl = useIntl();
  const tabs: {
    format: BookDiscoveryFormat;
    label: (typeof messages)[keyof typeof messages];
    icon: typeof BookOpenIcon;
    pathname: string;
    queryFormat?: 'ebook';
  }[] = [
    {
      format: 'all',
      label: messages.allBooks,
      icon: Squares2X2Icon,
      pathname: '/discover/books',
    },
    {
      format: 'ebook',
      label: messages.books,
      icon: BookOpenIcon,
      pathname: '/discover/books',
      queryFormat: 'ebook',
    },
    {
      format: 'audiobook',
      label: messages.audiobooks,
      icon: SpeakerWaveIcon,
      pathname: '/discover/audiobooks',
    },
  ];
  const preservedQuery = Object.fromEntries(
    Object.entries(query).filter(([key]) => key !== 'page' && key !== 'format')
  );

  return (
    <nav
      aria-label={intl.formatMessage(messages.format)}
      className={`flex flex-wrap gap-2 ${className}`}
      data-testid="book-format-tabs"
    >
      {tabs.map((tab) => {
        const isSelected = tab.format === format;
        const Icon = tab.icon;

        return (
          <Link
            key={tab.format}
            href={{
              pathname: tab.pathname,
              query: {
                ...preservedQuery,
                ...(tab.queryFormat ? { format: tab.queryFormat } : {}),
              },
            }}
            aria-current={isSelected ? 'page' : undefined}
            data-testid={`book-format-tab-${tab.format}`}
            className={getFilterToggleButtonClass(isSelected)}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{intl.formatMessage(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default BookFormatTabs;
