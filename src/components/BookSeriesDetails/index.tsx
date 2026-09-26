import AuthorWorkCard from '@app/components/AuthorDetails/AuthorWorkCard';
import BookSeriesSummaryCard from '@app/components/BookSeriesDetails/BookSeriesSummaryCard';
import CollectionAssociationsButton from '@app/components/CollectionDetails/CollectionAssociationsButton';
import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ThreeItemScroll from '@app/components/Common/ThreeItemScroll';
import {
  CompactRatingSelect,
  CompactSelect,
  FilterResetButton,
  type CompactSelectOption,
  type RatingOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import {
  BOOK_GENRES,
  BOOK_LANGUAGES,
} from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type {
  BookResult,
  BookSeriesDetails as BookSeriesDetailsType,
} from '@server/models/Book';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.BookSeriesDetails', {
  requestCollection: 'Request Collection',
  books: 'Books',
  audiobooks: 'Audiobooks',
  selectAll: 'Select All',
  selectNone: 'Clear Selection',
  selectAllHelp: 'Select every book shown in this collection.',
  selectNoneHelp: 'Clear the collection request selection.',
  noSelection: 'Select at least one book to request.',
  selectedCount: '{selected} of {total} books selected',
  clearFilters: 'Clear Filters',
  firstPublished: 'First Published',
  genres: 'Genres',
  rating: 'Rating',
  language: 'Language',
  any: 'Any',
  empty: 'No books match the current filters.',
});

const normalizeSeriesTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const sortSeriesBooks = (books: BookResult[], title: string) => {
  const seriesTitle = normalizeSeriesTitle(title);
  return [...books].sort((left, right) => {
    const position = (book: BookResult) =>
      Number(
        book.series?.find(
          (series) => normalizeSeriesTitle(series.title) === seriesTitle
        )?.position
      );
    const leftPosition = position(left);
    const rightPosition = position(right);
    const leftHasPosition = Number.isFinite(leftPosition);
    const rightHasPosition = Number.isFinite(rightPosition);
    if (leftHasPosition && rightHasPosition && leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
    if (leftHasPosition !== rightHasPosition) return leftHasPosition ? -1 : 1;
    return left.title.localeCompare(right.title, undefined, { numeric: true });
  });
};

const BookSeriesDetails = ({ series }: { series?: BookSeriesDetailsType }) => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const seriesId =
    typeof router.query.seriesId === 'string' ? router.query.seriesId : '';
  const [showRequest, setShowRequest] = useState(false);
  const [requestFormat, setRequestFormat] = useState<'ebook' | 'audiobook'>(
    'ebook'
  );
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [firstPublished, setFirstPublished] = useState('');
  const [genre, setGenre] = useState('');
  const [rating, setRating] = useState('');
  const [language, setLanguage] = useState('');
  const { data, error, mutate } = useSWR<BookSeriesDetailsType>(
    seriesId ? `/api/v1/series/${encodeApiPathSegment(seriesId)}` : null,
    { fallbackData: series }
  );
  const { data: bookServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/readarr'
  );

  const sortedBooks = useMemo(
    () => sortSeriesBooks(data?.books ?? [], data?.title ?? ''),
    [data?.books, data?.title]
  );
  const visibleBooks = useMemo(
    () =>
      sortedBooks.filter((book) => {
        if (
          firstPublished &&
          (firstPublished === 'before-1970'
            ? !book.firstPublishYear || book.firstPublishYear >= 1970
            : book.firstPublishYear?.toString() !== firstPublished)
        ) {
          return false;
        }
        if (
          genre &&
          !book.subjects?.some((subject) =>
            subject.toLowerCase().includes(genre.replace(/_/g, ' '))
          )
        ) {
          return false;
        }
        if (rating && (book.ratingsAverage ?? 0) < Number(rating)) return false;
        if (language && !book.languages?.includes(language)) return false;
        return true;
      }),
    [firstPublished, genre, language, rating, sortedBooks]
  );
  const visibleIds = useMemo(
    () => visibleBooks.map((book) => book.id),
    [visibleBooks]
  );
  const selectedVisibleIds = useMemo(
    () =>
      selectedIds === null
        ? visibleIds
        : selectedIds.filter((id) => visibleIds.includes(id)),
    [selectedIds, visibleIds]
  );
  const selectedBooks = useMemo(
    () => visibleBooks.filter((book) => selectedVisibleIds.includes(book.id)),
    [selectedVisibleIds, visibleBooks]
  );
  const bulkItems = useMemo(
    () =>
      selectedBooks.map((book) => ({
        id: book.id,
        title: book.title,
        year: book.firstPublishYear,
        image: book.posterPath,
        artist: book.author,
        isbn13: book.isbn13,
        editionId: book.editionId,
        authorId: book.authorId,
        mediaInfo: book.mediaInfo,
        subjects: book.subjects,
        languages: book.languages,
        ratingsAverage: book.ratingsAverage,
      })),
    [selectedBooks]
  );
  const toggleBook = (id: string) => {
    setSelectedIds((current) => {
      const selection = current ?? visibleIds;
      return selection.includes(id)
        ? selection.filter((value) => value !== id)
        : [...selection, id];
    });
  };

  if (!data && !error) return <LoadingSpinner />;
  if (!data) return <ErrorPage statusCode={404} />;

  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: new Date().getFullYear() - 1969 }, (_, index) => {
      const year = new Date().getFullYear() - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const genreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_GENRES.map(([value, label]) => ({ value, label })),
  ];
  const ratingOptions: RatingOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: 9 }, (_, index) => {
      const score = 1 + index * 0.5;
      return { label: score.toFixed(1) + '+', value: score.toFixed(1), score };
    }),
  ];
  const languageOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_LANGUAGES.map(([value, label]) => ({ value, label })),
  ];
  const hasEbookServer = (bookServices ?? []).some(
    (service) => (service.serviceType ?? 'ebook') === 'ebook'
  );
  const hasAudiobookServer = (bookServices ?? []).some(
    (service) => service.serviceType === 'audiobook'
  );
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );

  return (
    <>
      <PageTitle title={`${data.title} Collection`} />
      {showRequest && (
        <BulkRequestModal
          show={showRequest}
          mediaType="book"
          seriesId={data.id}
          title={data.title}
          initialBookFormat={requestFormat}
          initialItems={bulkItems}
          onCancel={() => setShowRequest(false)}
          onComplete={() => {
            setShowRequest(false);
            void mutate();
          }}
        />
      )}
      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {sortedBooks[0]?.posterPath && (
          <MediaDetailArtwork type="book" src={sortedBooks[0].posterPath} />
        )}
        <div className="card-stack relative z-10">
          <BookSeriesSummaryCard
            seriesId={data.id}
            title={data.title}
            initialData={data}
            standalone
          />
          <div className="media-primary-action-row music-collection-primary-action-row">
            <CollectionAssociationsButton
              parts={sortedBooks}
              mediaType="book"
            />
            {canRequest && sortedBooks.length > 0 && (
              <FormatRequestControl
                label={intl.formatMessage(messages.requestCollection)}
                options={(
                  [
                    ['ebook', messages.books, hasEbookServer],
                    ['audiobook', messages.audiobooks, hasAudiobookServer],
                  ] as const
                ).map(([value, label, enabled]) => ({
                  id: value,
                  label: intl.formatMessage(label),
                  disabled: !enabled || selectedBooks.length === 0,
                  disabledReason:
                    selectedBooks.length === 0
                      ? intl.formatMessage(messages.noSelection)
                      : undefined,
                  onClick: () => {
                    setRequestFormat(value);
                    setShowRequest(true);
                  },
                }))}
              />
            )}
          </div>
          <div className="media-detail-disclosure-row music-collection-action-row">
            <Button
              buttonType="association"
              title={intl.formatMessage(messages.selectAllHelp)}
              onClick={() => setSelectedIds(visibleIds)}
            >
              <CheckCircleIcon />
              <span>{intl.formatMessage(messages.selectAll)}</span>
            </Button>
            <Button
              buttonType="association"
              title={intl.formatMessage(messages.selectNoneHelp)}
              onClick={() => setSelectedIds([])}
            >
              <XMarkIcon />
              <span>{intl.formatMessage(messages.selectNone)}</span>
            </Button>
            <span className="self-center text-sm text-gray-300" role="status">
              {intl.formatMessage(messages.selectedCount, {
                selected: selectedBooks.length,
                total: visibleBooks.length,
              })}
            </span>
          </div>
          <div className="card-spacing-before flex flex-wrap gap-2">
            <FilterResetButton
              label={intl.formatMessage(messages.clearFilters)}
              selected={!firstPublished && !genre && !rating && !language}
              onClick={() => {
                setFirstPublished('');
                setGenre('');
                setRating('');
                setLanguage('');
              }}
            />
            <CompactSelect
              label={intl.formatMessage(messages.firstPublished)}
              value={firstPublished}
              options={yearOptions}
              onChange={setFirstPublished}
            />
            <CompactSelect
              label={intl.formatMessage(messages.genres)}
              value={genre}
              options={genreOptions}
              onChange={setGenre}
            />
            <CompactRatingSelect
              label={intl.formatMessage(messages.rating)}
              value={rating}
              options={ratingOptions}
              maxScore={5}
              onChange={setRating}
            />
            <CompactSelect
              label={intl.formatMessage(messages.language)}
              value={language}
              options={languageOptions}
              onChange={setLanguage}
            />
          </div>
          <section className="card-spacing-before">
            {visibleBooks.length > 0 ? (
              <ThreeItemScroll label={data.title}>
                {visibleBooks.map((book) => (
                  <AuthorWorkCard
                    key={book.id}
                    work={book}
                    author={book.author ?? ''}
                    selected={selectedVisibleIds.includes(book.id)}
                    onToggle={() => toggleBook(book.id)}
                  />
                ))}
              </ThreeItemScroll>
            ) : (
              <Alert type="info">{intl.formatMessage(messages.empty)}</Alert>
            )}
          </section>
        </div>
      </article>
    </>
  );
};

export default BookSeriesDetails;
