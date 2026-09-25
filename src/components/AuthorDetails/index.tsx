import AuthorSummaryCard from '@app/components/AuthorDetails/AuthorSummaryCard';
import AuthorWorkCard, {
  getBookFormatState,
} from '@app/components/AuthorDetails/AuthorWorkCard';
import CollectionAssociationsButton from '@app/components/CollectionDetails/CollectionAssociationsButton';
import Button from '@app/components/Common/Button';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ThreeItemScroll from '@app/components/Common/ThreeItemScroll';
import MediaFilterOption from '@app/components/Discover/MediaFilterOption';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import useMediaFilterPin from '@app/hooks/useMediaFilterPin';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  BookOpenIcon,
  SpeakerWaveIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type {
  AuthorDetails as AuthorDetailsType,
  BookResult,
} from '@server/models/Book';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.AuthorDetails', {
  bibliography: 'Bibliography',
  requestbibliography: 'Request Bibliography',
  mediaType: 'Media Type',
  allBooks: 'All Books',
  books: 'Books',
  audiobooks: 'Audiobooks',
  loadmore: 'Load More',
  empty: 'No works are listed for this author.',
});

type DisplayFormat = 'all' | 'ebook' | 'audiobook';
const displayFormats: readonly DisplayFormat[] = ['all', 'ebook', 'audiobook'];

const AuthorDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const authorId = router.query.authorId as string | undefined;
  const [showBulkRequestModal, setShowBulkRequestModal] = useState(false);
  const [format, setFormat] = useState<'ebook' | 'audiobook'>('ebook');
  const [displayFormat, setDisplayFormat] = useState<DisplayFormat>('all');
  const pin = useMediaFilterPin<DisplayFormat>({
    scope: 'books',
    selected: displayFormat,
    values: displayFormats,
    restore: setDisplayFormat,
  });
  const [extraWorks, setExtraWorks] = useState<BookResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const { data: bookServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/readarr'
  );
  const hasEbookServer = (bookServices ?? []).some(
    (service) => (service.serviceType ?? 'ebook') === 'ebook'
  );
  const hasAudiobookServer = (bookServices ?? []).some(
    (service) => service.serviceType === 'audiobook'
  );
  const { data, error, mutate } = useSWR<AuthorDetailsType>(
    authorId ? `/api/v1/author/${encodeApiPathSegment(authorId)}` : null
  );

  useEffect(() => setExtraWorks([]), [authorId]);
  const works = useMemo(() => {
    const unique = new Map<string, BookResult>();
    [...(data?.works ?? []), ...extraWorks].forEach((work) =>
      unique.set(work.id, work)
    );
    return [...unique.values()];
  }, [data?.works, extraWorks]);
  const visibleWorks = useMemo(
    () =>
      works.filter((work) => {
        if (displayFormat === 'all') return true;
        const ebook = getBookFormatState(work, 'ebook') !== 'unavailable';
        const audiobook =
          getBookFormatState(work, 'audiobook') !== 'unavailable';
        return displayFormat === 'ebook'
          ? ebook || !audiobook
          : audiobook || !ebook;
      }),
    [displayFormat, works]
  );
  const bulkItems = useMemo(
    () =>
      (data?.works ?? []).map((work) => ({
        id: work.id,
        title: work.title,
        year: work.firstPublishYear,
        image: work.posterPath,
        artist: data?.name,
        isbn13: work.isbn13,
        editionId: work.editionId,
        authorId: data?.id,
        mediaInfo: work.mediaInfo,
        subjects: work.subjects,
        languages: work.languages,
        ratingsAverage: work.ratingsAverage,
      })),
    [data]
  );

  if (!data && !error) return <LoadingSpinner />;
  if (!data) return <ErrorPage statusCode={404} />;

  const loadMore = async () => {
    if (loadingMore || works.length >= data.pagination.totalItems) return;
    setLoadingMore(true);
    try {
      const response = await axios.get<{ works: BookResult[] }>(
        `/api/v1/author/${encodeApiPathSegment(data.id)}/works`,
        { params: { offset: works.length, limit: 50 } }
      );
      setExtraWorks((current) => [...current, ...response.data.works]);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <PageTitle title={`${data.name} Bibliography`} />
      {showBulkRequestModal && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="book"
          authorId={data.id}
          title={data.name}
          initialBookFormat={format}
          initialItems={bulkItems}
          initialTotalItems={data.pagination.totalItems}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => mutate()}
        />
      )}
      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {data.posterPath && (
          <MediaDetailArtwork type="book" src={data.posterPath} />
        )}
        <div className="card-stack relative z-10">
          <AuthorSummaryCard author={data} />
          <div className="media-primary-action-row">
            <nav
              aria-label={intl.formatMessage(messages.mediaType)}
              className="flex flex-wrap gap-2"
            >
              {displayFormats.map((value) => {
                const label = intl.formatMessage(
                  value === 'all'
                    ? messages.allBooks
                    : value === 'ebook'
                      ? messages.books
                      : messages.audiobooks
                );
                const Icon =
                  value === 'all'
                    ? Squares2X2Icon
                    : value === 'ebook'
                      ? BookOpenIcon
                      : SpeakerWaveIcon;
                return (
                  <MediaFilterOption
                    key={value}
                    pin={pin}
                    value={value}
                    label={label}
                    selected={displayFormat === value}
                  >
                    <button
                      type="button"
                      aria-pressed={displayFormat === value}
                      onClick={() => setDisplayFormat(value)}
                      className="flex h-full items-center gap-1.5 px-2"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  </MediaFilterOption>
                );
              })}
            </nav>
            <CollectionAssociationsButton parts={works} mediaType="book" />
            {hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
              type: 'or',
            }) && (
              <FormatRequestControl
                label={intl.formatMessage(messages.requestbibliography)}
                options={(
                  [
                    ['ebook', messages.books, hasEbookServer],
                    ['audiobook', messages.audiobooks, hasAudiobookServer],
                  ] as const
                ).map(([value, label, enabled]) => ({
                  id: value,
                  label: intl.formatMessage(label),
                  disabled: !enabled,
                  onClick: () => {
                    setFormat(value);
                    setShowBulkRequestModal(true);
                  },
                }))}
              />
            )}
          </div>
          <section>
            <h2 className="slider-title">
              {intl.formatMessage(messages.bibliography)}
              <span className="ml-2 text-sm text-gray-400">
                ({data.pagination.totalItems})
              </span>
            </h2>
            {visibleWorks.length ? (
              <ThreeItemScroll
                label={intl.formatMessage(messages.bibliography)}
              >
                {visibleWorks.map((work) => (
                  <AuthorWorkCard
                    key={work.id}
                    work={work}
                    author={data.name}
                  />
                ))}
              </ThreeItemScroll>
            ) : (
              <p>{intl.formatMessage(messages.empty)}</p>
            )}
            {works.length < data.pagination.totalItems && (
              <div className="mt-2">
                <Button
                  buttonType="ghost"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {intl.formatMessage(messages.loadmore)}
                </Button>
              </div>
            )}
          </section>
        </div>
      </article>
    </>
  );
};

export default AuthorDetails;
