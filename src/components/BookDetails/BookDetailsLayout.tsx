import CachedImage from '@app/components/Common/CachedImage';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import type { BookDetails } from '@server/models/Book';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.BookDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  firstPublished: 'First Published',
  pages: 'Pages',
  publisher: 'Publisher',
  author: 'Author',
  editions: 'Editions',
  isbn: 'ISBN',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  genres: 'Genres',
  noGenres: 'No Genres Available',
  bookDetails: 'Book Details',
  openLibrary: 'Open Library',
  edition: 'Edition',
  isbnCandidates: 'ISBN Candidates',
  available: 'Available',
  requested: 'Requested',
  notRequested: 'Not Requested',
  notAvailable: 'Not available',
});

export interface BookFormatCoverage {
  format: 'ebook' | 'audiobook';
  available: boolean;
  requested: boolean;
}

interface BookDetailsLayoutProps {
  data: BookDetails;
  formatCoverage: BookFormatCoverage[];
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
  additionalContent?: ReactNode;
}

const genreTones = [
  'border-indigo-400/80 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/35',
  'border-purple-400/80 bg-purple-500/20 text-purple-100 hover:bg-purple-500/35',
  'border-emerald-400/80 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35',
  'border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35',
  'border-sky-400/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/35',
  'border-rose-400/80 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35',
] as const;

const BookDetailsLayout = ({
  data,
  formatCoverage,
  primaryActions,
  secondaryActions,
  additionalContent,
}: BookDetailsLayoutProps) => {
  const intl = useIntl();
  const [showGenres, setShowGenres] = useState(false);
  const unavailable = intl.formatMessage(messages.notAvailable);
  const workId = encodeApiPathSegment(data.id);
  const authorId = data.authorId
    ? encodeApiPathSegment(data.authorId)
    : undefined;
  const availableFormats = formatCoverage
    .filter((format) => format.available)
    .map((format) =>
      intl.formatMessage(
        format.format === 'ebook' ? messages.ebook : messages.audiobook
      )
    );
  const mediaAndFormat = `Book${
    availableFormats.length > 0 ? ` · ${availableFormats.join(' + ')}` : ''
  }`;
  const genres = [
    ...new Set((data.subjects ?? []).map((genre) => genre.trim())),
  ]
    .filter(Boolean)
    .slice(0, 50);
  const formatStatus = (coverage: BookFormatCoverage) =>
    intl.formatMessage(
      coverage.available
        ? messages.available
        : coverage.requested
          ? messages.requested
          : messages.notRequested
    );

  return (
    <div className="media-page">
      <article className="refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 text-gray-400 shadow-lg shadow-gray-950/20">
        {data.posterPath && (
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <CachedImage
              type="book"
              src={data.posterPath}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-center"
            />
            <div className="refreshed-artwork-scrim" />
            <div className="refreshed-artwork-gradient" />
          </div>
        )}

        <div className="relative z-10">
          <h1
            className="text-lg font-semibold leading-5 text-white"
            data-testid="media-title"
          >
            {data.title}
            {data.firstPublishYear ? ` (${data.firstPublishYear})` : ''}
          </h1>

          <div className="mt-4 grid min-w-0 grid-cols-1 card:grid-cols-3">
            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.mediaAndFormat)}:
              </dt>
              <dd className="m-0 truncate">{mediaAndFormat}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.firstPublished)}:
              </dt>
              <dd className="m-0 truncate">
                {data.firstPublishYear ?? unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.pages)}:
              </dt>
              <dd className="m-0 truncate">
                {data.numberOfPages
                  ? intl.formatNumber(data.numberOfPages)
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.publisher)}:
              </dt>
              <dd className="m-0 truncate">{data.publisher || unavailable}</dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.author)}:
              </dt>
              <dd className="m-0 truncate">
                {data.author ? (
                  authorId ? (
                    <Link
                      href={`/author/${authorId}`}
                      className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      {data.author}
                    </Link>
                  ) : (
                    data.author
                  )
                ) : (
                  unavailable
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.editions)}:
              </dt>
              <dd className="m-0 truncate">
                {data.editionCount
                  ? intl.formatNumber(data.editionCount)
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.isbn)}:
              </dt>
              <dd className="m-0 truncate">{data.isbn13 || unavailable}</dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              {formatCoverage.map((coverage) => (
                <div className="contents" key={coverage.format}>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(
                      coverage.format === 'ebook'
                        ? messages.ebook
                        : messages.audiobook
                    )}
                    :
                  </dt>
                  <dd
                    className={`m-0 truncate ${
                      coverage.available
                        ? 'text-emerald-300'
                        : coverage.requested
                          ? 'text-indigo-200'
                          : ''
                    }`}
                  >
                    {formatStatus(coverage)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-[5px] flex flex-wrap items-center justify-start gap-2">
            {primaryActions}
          </div>
          <div className="mt-[5px] flex flex-wrap items-center justify-end gap-2">
            {secondaryActions}
          </div>

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.overview)}
            </h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-5 text-gray-400">
              {data.description ||
                intl.formatMessage(messages.overviewUnavailable)}
            </p>
          </section>

          <div className="mt-[5px] flex flex-wrap items-center gap-2">
            <DetailDisclosureButton
              label={intl.formatMessage(messages.genres)}
              open={showGenres}
              onClick={() => setShowGenres((open) => !open)}
            />
          </div>

          {showGenres && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.genres)}
              </h2>
              {genres.length === 0 ? (
                <p className="text-xs text-gray-500">
                  {intl.formatMessage(messages.noGenres)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((genre, index) => (
                    <Link
                      key={genre}
                      href={`/discover/books?subject=${encodeURIComponent(genre)}&sortBy=ranked`}
                      className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                        genreTones[index % genreTones.length]
                      }`}
                    >
                      {genre}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="mb-3 text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.bookDetails)}
            </h2>
            <div className="grid grid-cols-1 card:grid-cols-3">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.firstPublished)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.firstPublishYear ?? unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.pages)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.numberOfPages
                    ? intl.formatNumber(data.numberOfPages)
                    : unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.editions)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.editionCount
                    ? intl.formatNumber(data.editionCount)
                    : unavailable}
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.publisher)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.publisher || unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.author)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.author ? (
                    authorId ? (
                      <Link
                        href={`/author/${authorId}`}
                        className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        {data.author}
                      </Link>
                    ) : (
                      data.author
                    )
                  ) : (
                    unavailable
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.edition)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.editionId || unavailable}
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.openLibrary)}:
                </dt>
                <dd className="m-0 truncate">
                  <a
                    href={`https://openlibrary.org/works/${workId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {data.id}
                  </a>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.isbnCandidates)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {data.isbnCandidates?.length
                    ? data.isbnCandidates.slice(0, 4).map((candidate) => (
                        <span
                          className="block truncate"
                          key={`${candidate.editionId ?? candidate.isbn}-${candidate.isbn}`}
                          title={[
                            candidate.isbn,
                            candidate.title,
                            candidate.format,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {candidate.isbn}
                        </span>
                      ))
                    : unavailable}
                </dd>
              </dl>
            </div>
          </section>
          {additionalContent}
        </div>
      </article>
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default BookDetailsLayout;
