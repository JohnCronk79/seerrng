import CollectionRatings from '@app/components/CollectionDetails/CollectionRatings';
import CachedImage from '@app/components/Common/CachedImage';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import MovieSummaryCard from '@app/components/MediaDetails/MovieSummaryCard';
import MusicRatings from '@app/components/MediaDetails/MusicRatings';
import type { AssociationEdge } from '@app/hooks/useAssociations';
import globalMessages from '@app/i18n/globalMessages';
import { getCollectionMemberRatings } from '@app/utils/collectionRatings';
import { MediaStatus } from '@server/constants/media';
import Link from 'next/link';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';
import {
  nodeBackdrop,
  nodeHref,
  nodeImage,
  nodeImageType,
  nodeTitle,
} from './helpers';
import useAssociationMovieDetails from './useAssociationMovieDetails';
import useAssociationRatings from './useAssociationRatings';

const getMediaLabel = (edge: AssociationEdge) => {
  switch (edge.node.mediaType) {
    case 'movie':
      return 'Movie';
    case 'tv':
      return 'Series';
    case 'album':
      return 'Album';
    case 'artist':
      return 'Artist';
    case 'book':
      return 'Book';
    case 'person':
      return 'Person';
  }
};

const getReleaseDate = (edge: AssociationEdge) => {
  switch (edge.node.mediaType) {
    case 'movie':
      return edge.node.releaseDate;
    case 'tv':
      return edge.node.firstAirDate;
    case 'album':
      return edge.node['first-release-date'];
    case 'book':
      return edge.node.firstPublishYear?.toString();
    default:
      return undefined;
  }
};

const getStatusLabel = (status: MediaStatus | undefined) => {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return globalMessages.available;
    case MediaStatus.PARTIALLY_AVAILABLE:
      return globalMessages.partiallyavailable;
    case MediaStatus.PROCESSING:
      return globalMessages.processing;
    case MediaStatus.PENDING:
      return globalMessages.requested;
    case MediaStatus.BLOCKLISTED:
      return globalMessages.blocklisted;
    default:
      return globalMessages.notrequested;
  }
};

interface AssociationDetailCardProps {
  edge: AssociationEdge;
  onSelect?: () => void;
}

const AssociationDetailCard = ({
  edge,
  onSelect,
}: AssociationDetailCardProps) => {
  const intl = useIntl();
  const { ref: movieRef, data: movie } = useAssociationMovieDetails(
    edge.node.mediaType === 'movie' ? edge.node.id : undefined
  );
  const {
    ref: ratingRef,
    videoRatings,
    albumRatings,
  } = useAssociationRatings(edge.node);
  const setCardRef = (element: HTMLElement | null) => {
    movieRef.current = element;
    ratingRef.current = element;
  };
  const image = nodeImage(edge.node);
  const backdrop = nodeBackdrop(edge.node);
  const mediaInfo = 'mediaInfo' in edge.node ? edge.node.mediaInfo : undefined;
  const isAlbum = edge.node.mediaType === 'album';
  const qualityStatuses =
    edge.node.mediaType === 'album' ? edge.node.qualityStatuses : undefined;
  const status = isAlbum
    ? (qualityStatuses?.find(({ quality }) => quality === 'MP3')?.status ??
      mediaInfo?.status)
    : mediaInfo?.status;
  const status4k = isAlbum
    ? (qualityStatuses?.find(({ quality }) => quality === 'FLAC')?.status ??
      mediaInfo?.status4k)
    : mediaInfo?.status4k;
  const primaryQualityLabel = isAlbum ? 'MP3' : 'HD';
  const secondaryQualityLabel = isAlbum ? 'FLAC' : '4K';
  const association = <span data-testid="association-type">{edge.reason}</span>;
  const node = edge.node;
  const videoRatingRow =
    node.mediaType === 'tv' ? (
      <CollectionRatings
        ratings={getCollectionMemberRatings(
          {
            id: Number(node.id),
            voteAverage: node.voteAverage,
            voteCount: node.voteCount,
          },
          videoRatings
        )
          .filter((rating) => rating.source !== 'imdb')
          .map((rating) =>
            rating.source === 'tmdb'
              ? { ...rating, href: 'https://www.themoviedb.org/tv/' + node.id }
              : rating
          )}
      />
    ) : undefined;
  const ratingRow =
    node.mediaType === 'album' ? (
      <MusicRatings
        ratings={albumRatings?.ratings}
        albumId={node.id}
        albumTitle={node.title}
        artist={node['artist-credit'].map((credit) => credit.name).join(', ')}
      />
    ) : (
      videoRatingRow
    );
  const isCollectionMedia =
    node.mediaType === 'tv' || node.mediaType === 'album';
  const releaseDate = getReleaseDate(edge);
  const formattedReleaseDate =
    releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
      ? intl.formatDate(releaseDate, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : releaseDate || 'Not Available';
  const title = nodeTitle(node);
  const titleWithYear =
    isCollectionMedia && releaseDate
      ? title + ' (' + releaseDate.slice(0, 4) + ')'
      : title;
  const available = (value?: MediaStatus) =>
    value === MediaStatus.AVAILABLE ||
    value === MediaStatus.PARTIALLY_AVAILABLE;
  const formats = [
    available(status) ? primaryQualityLabel : undefined,
    available(status4k) ? secondaryQualityLabel : undefined,
  ].filter(Boolean);
  const mediaAndFormat =
    getMediaLabel(edge) + (formats.length ? ' · ' + formats.join(' + ') : '');
  const middleRows: [string, string | undefined][] =
    node.mediaType === 'book'
      ? [
          ['Author', node.author],
          ['Publisher', node.publisher],
          ['ISBN', node.isbn13],
        ]
      : node.mediaType === 'album'
        ? [
            [
              'Artist',
              node['artist-credit'].map((credit) => credit.name).join(', '),
            ],
            ['Type', node['primary-type']],
          ]
        : node.mediaType === 'artist'
          ? [
              ['Type', node.type],
              ['Country', node.country],
            ]
          : node.mediaType === 'tv'
            ? [
                ['Director', node.directors?.join(', ')],
                ['Writer', node.writers?.join(', ')],
                [
                  'Language',
                  intl.formatDisplayName(node.originalLanguage, {
                    type: 'language',
                  }),
                ],
              ]
            : node.mediaType === 'person'
              ? [['Known For', node.knownFor.map(nodeTitle).join(', ')]]
              : [];
  const isVideo = node.mediaType === 'movie' || node.mediaType === 'tv';
  const qualities =
    isVideo || isAlbum
      ? ([
          [primaryQualityLabel, status],
          [secondaryQualityLabel, status4k],
        ] as const)
      : node.mediaType === 'book'
        ? ([['Status', status]] as const)
        : [];

  if (node.mediaType === 'movie') {
    return (
      <article ref={movieRef} data-testid="association-detail-card">
        <MovieSummaryCard
          data={
            movie ?? {
              ...node,
              runtime: 0,
              genres: [],
              productionCompanies: [],
            }
          }
          sortedCrew={movie?.credits.crew ?? []}
          show4kAvailability
          href={nodeHref(node)}
          onSelect={onSelect}
          standalone
          artwork={
            backdrop && (
              <div
                className="pointer-events-none absolute inset-0 z-0"
                aria-hidden
              >
                <CachedImage
                  type="tmdb"
                  src={backdrop}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 56rem, 100vw"
                  className="object-cover object-center"
                />
                <div className="refreshed-artwork-scrim" />
                <div className="refreshed-artwork-gradient" />
              </div>
            )
          }
          availabilityFooter={association}
        />
      </article>
    );
  }

  return (
    <article
      data-testid="association-detail-card"
      ref={setCardRef}
      className="detail-summary-standalone refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20"
    >
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <CachedImage
            type={nodeImageType(edge.node)}
            src={backdrop}
            alt=""
            fill
            sizes="(min-width: 640px) 56rem, 100vw"
            className="object-cover object-center"
          />
          <div className="refreshed-artwork-scrim" />
          <div className="refreshed-artwork-gradient" />
        </div>
      )}

      <div className="movie-summary-card relative z-10">
        <div className="collection-summary-poster">
          <CachedImage
            type={nodeImageType(node)}
            src={image || '/images/seerr_poster_not_found.png'}
            alt=""
            fill
            sizes="(min-width: 640px) 80px, 64px"
            className="collection-summary-poster-image"
          />
          <Link
            href={nodeHref(node)}
            onClick={onSelect}
            className="movie-summary-poster-link"
            aria-label={title}
          />
        </div>

        <div className="relative z-10 flex min-w-0 flex-col">
          <h3
            className={
              isCollectionMedia
                ? 'movie-summary-title'
                : 'detail-summary-title truncate text-lg leading-5 font-semibold text-white'
            }
          >
            <Link href={nodeHref(node)} onClick={onSelect}>
              {titleWithYear}
            </Link>
          </h3>

          {isCollectionMedia ? (
            <div className="movie-summary-fields movie-summary-fields-with-ratings detail-card-heading-spacing grid min-w-0 flex-1">
              <div className="detail-paired-column-span min-w-0">
                <dl className="media-detail-rows detail-paired-columns grid min-w-0 content-start text-xs">
                  <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                    Media &amp; Format:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                    {mediaAndFormat}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                    Release Date:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                    {formattedReleaseDate}
                  </dd>
                  <div className="media-detail-rows media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                    {middleRows.map(([label, value]) => (
                      <Fragment key={label}>
                        <dt className="font-medium text-gray-100">{label}:</dt>
                        <dd className="m-0 truncate" title={value}>
                          {value || 'Not Available'}
                        </dd>
                      </Fragment>
                    ))}
                  </div>
                </dl>
              </div>
              <div className="media-detail-column-divider flex min-w-0 flex-col text-xs leading-4">
                <dl className="media-detail-rows grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                  {qualities.map(([label, qualityStatus]) => (
                    <Fragment key={label}>
                      <dt className="font-medium text-gray-100">{label}:</dt>
                      <dd className="m-0 truncate">
                        <AvailabilityValue status={qualityStatus}>
                          {intl.formatMessage(getStatusLabel(qualityStatus))}
                        </AvailabilityValue>
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                <div className="detail-summary-footer">{association}</div>
              </div>
              {ratingRow && (
                <div className="movie-summary-ratings-row">
                  <div className="movie-summary-ratings-empty" aria-hidden />
                  <div className="movie-summary-ratings-values">
                    {ratingRow}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="detail-card-heading-spacing detail-three-column-grid grid min-h-0 min-w-0 flex-1 items-stretch text-xs leading-4">
              <dl className="media-detail-rows card:pr-3 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                <dt className="font-medium text-gray-100">
                  Media &amp; Format:
                </dt>
                <dd className="m-0 truncate">{getMediaLabel(edge)}</dd>
                <dt className="font-medium text-gray-100">Release Date:</dt>
                <dd className="m-0 truncate">
                  {releaseDate || 'Not Available'}
                </dd>
              </dl>
              <dl className="media-detail-rows media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                {middleRows.map(([label, value]) => (
                  <Fragment key={label}>
                    <dt className="font-medium text-gray-100">{label}:</dt>
                    <dd className="m-0 truncate" title={value}>
                      {value || 'Not Available'}
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <div className="media-detail-column-divider flex min-w-0 flex-col">
                <dl className="media-detail-rows grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                  {qualities.map(([label, qualityStatus]) => (
                    <Fragment key={label}>
                      <dt className="font-medium text-gray-100">{label}:</dt>
                      <dd className="m-0 truncate">
                        <AvailabilityValue status={qualityStatus}>
                          {intl.formatMessage(getStatusLabel(qualityStatus))}
                        </AvailabilityValue>
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                <div className="detail-summary-footer">{association}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

export default AssociationDetailCard;
