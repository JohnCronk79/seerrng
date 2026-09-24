import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  BookResult,
  BookSeriesDetails as BookSeriesDetailsType,
} from '@server/models/Book';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookSeriesDetails', {
  volumes: '{count} volumes',
  requestMissing: 'Request Missing Books',
  volume: 'Volume {position}',
  ebook: 'Book',
  audiobook: 'Audiobook',
  available: 'Available',
  requested: 'Requested',
  missing: 'Missing',
  descriptionUnavailable:
    'Series information comes from the configured Bookshelf catalog.',
  noVolumes: 'No catalog volumes were found for this series.',
});

type BookFormat = 'ebook' | 'audiobook';

const hasAvailableFormat = (book: BookResult, format: BookFormat) => {
  const media = book.mediaInfo;
  if (!media) return false;
  return format === 'ebook'
    ? media.serviceId !== null &&
        media.serviceId !== undefined &&
        media.externalServiceId !== null &&
        media.externalServiceId !== undefined
    : media.audiobookServiceId !== null &&
        media.audiobookServiceId !== undefined &&
        media.audiobookExternalServiceId !== null &&
        media.audiobookExternalServiceId !== undefined;
};

const hasRequestedFormat = (book: BookResult, format: BookFormat) =>
  book.mediaInfo?.requests?.some(
    (request) =>
      ((request.bookFormat ?? 'ebook') === format ||
        request.bookFormat === 'both') &&
      (request.status === MediaRequestStatus.PENDING ||
        request.status === MediaRequestStatus.APPROVED)
  ) ?? false;

const normalizeSeriesTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getFormatState = (book: BookResult, format: BookFormat) => {
  if (hasAvailableFormat(book, format)) return 'available';
  if (hasRequestedFormat(book, format)) return 'requested';
  return 'missing';
};

const BookSeriesDetails = ({ series }: { series?: BookSeriesDetailsType }) => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const [showBulkRequestModal, setShowBulkRequestModal] = useState(false);
  const seriesId =
    typeof router.query.seriesId === 'string' ? router.query.seriesId : '';
  const { data, error, mutate } = useSWR<BookSeriesDetailsType>(
    seriesId ? `/api/v1/series/${encodeApiPathSegment(seriesId)}` : null,
    { fallbackData: series }
  );

  const sortedBooks = useMemo(() => {
    const books = [...(data?.books ?? [])];
    const seriesTitle = normalizeSeriesTitle(data?.title ?? '');
    return books.sort((left, right) => {
      const leftPosition = Number(
        left.series?.find(
          (series) => normalizeSeriesTitle(series.title) === seriesTitle
        )?.position
      );
      const rightPosition = Number(
        right.series?.find(
          (series) => normalizeSeriesTitle(series.title) === seriesTitle
        )?.position
      );
      const leftHasPosition = Number.isFinite(leftPosition);
      const rightHasPosition = Number.isFinite(rightPosition);
      if (
        leftHasPosition &&
        rightHasPosition &&
        leftPosition !== rightPosition
      ) {
        return leftPosition - rightPosition;
      }
      if (leftHasPosition !== rightHasPosition) return leftHasPosition ? -1 : 1;
      return left.title.localeCompare(right.title, undefined, {
        numeric: true,
      });
    });
  }, [data?.books, data?.title]);

  const bulkItems = useMemo(
    () =>
      sortedBooks.map((book) => ({
        id: book.id,
        title: book.title,
        year: book.firstPublishYear,
        image: book.posterPath,
        artist: book.author,
        isbn13: book.isbn13,
        editionId: book.editionId,
        authorId: book.authorId,
        mediaInfo: book.mediaInfo,
      })),
    [sortedBooks]
  );

  if (!data && !error) return <LoadingSpinner />;
  if (!data) return <ErrorPage statusCode={404} />;

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );
  const availableCounts = {
    ebook: sortedBooks.filter((book) => hasAvailableFormat(book, 'ebook'))
      .length,
    audiobook: sortedBooks.filter((book) =>
      hasAvailableFormat(book, 'audiobook')
    ).length,
  };
  const formatLabel = (format: BookFormat) =>
    intl.formatMessage(
      format === 'ebook' ? messages.ebook : messages.audiobook
    );
  const formatStateLabel = (state: ReturnType<typeof getFormatState>) =>
    intl.formatMessage(
      state === 'available'
        ? messages.available
        : state === 'requested'
          ? messages.requested
          : messages.missing
    );

  return (
    <>
      <PageTitle title={data.title} />
      {showBulkRequestModal && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="book"
          title={data.title}
          initialItems={bulkItems}
          initialTotalItems={bulkItems.length}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => {
            setShowBulkRequestModal(false);
            void mutate();
          }}
        />
      )}
      <main className="media-page">
        <Header
          subtext={intl.formatMessage(messages.volumes, {
            count: intl.formatNumber(sortedBooks.length),
          })}
        >
          {data.title}
        </Header>
        <div className="refreshed-card-surface mb-4 flex flex-col gap-4 rounded-xl border border-gray-700 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-200">
              {data.description ||
                intl.formatMessage(messages.descriptionUnavailable)}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-300">
              <span>
                {formatLabel('ebook')}: {availableCounts.ebook}/
                {sortedBooks.length} {intl.formatMessage(messages.available)}
              </span>
              <span>
                {formatLabel('audiobook')}: {availableCounts.audiobook}/
                {sortedBooks.length} {intl.formatMessage(messages.available)}
              </span>
            </div>
          </div>
          {canRequest && sortedBooks.length > 0 && (
            <Button
              buttonType="primary"
              onClick={() => setShowBulkRequestModal(true)}
            >
              <ArrowDownTrayIcon />
              <span>{intl.formatMessage(messages.requestMissing)}</span>
            </Button>
          )}
        </div>

        {sortedBooks.length === 0 ? (
          <Alert type="info">{intl.formatMessage(messages.noVolumes)}</Alert>
        ) : (
          <ol className="space-y-2">
            {sortedBooks.map((book, index) => {
              const position = book.series?.find(
                (series) =>
                  normalizeSeriesTitle(series.title) ===
                  normalizeSeriesTitle(data.title)
              )?.position;
              const ebookState = getFormatState(book, 'ebook');
              const audioState = getFormatState(book, 'audiobook');

              return (
                <li
                  key={book.id}
                  className="refreshed-card-surface grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded-xl border border-gray-700 p-3 sm:grid-cols-[56px_minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-center"
                >
                  <div className="relative h-16 w-11 overflow-hidden rounded-md ring-1 ring-gray-700 sm:h-20 sm:w-14">
                    <CachedImage
                      type="book"
                      src={
                        book.posterPath || '/images/seerr_poster_not_found.png'
                      }
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide text-blue-200">
                      {position
                        ? intl.formatMessage(messages.volume, { position })
                        : intl.formatNumber(index + 1)}
                    </div>
                    <Link
                      href={`/book/${encodeApiPathSegment(book.id)}`}
                      className="mt-1 block truncate text-base font-semibold text-white hover:text-blue-200 hover:underline focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    >
                      {book.title}
                    </Link>
                    {book.author && (
                      <div className="refreshed-detail-text-muted mt-0.5 truncate text-sm">
                        {book.author}
                      </div>
                    )}
                  </div>
                  <dl className="col-span-2 grid grid-cols-2 gap-2 pl-[56px] text-xs sm:col-span-1 sm:pl-0">
                    {(['ebook', 'audiobook'] as const).map((format) => {
                      const state =
                        format === 'ebook' ? ebookState : audioState;
                      return (
                        <div key={format} className="min-w-0">
                          <dt className="mb-1 font-medium text-gray-300">
                            {formatLabel(format)}
                          </dt>
                          <dd className="m-0">
                            <AvailabilityValue
                              tone={
                                state === 'available'
                                  ? 'available'
                                  : state === 'requested'
                                    ? 'processing'
                                    : 'unavailable'
                              }
                            >
                              {formatStateLabel(state)}
                            </AvailabilityValue>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </>
  );
};

export default BookSeriesDetails;
