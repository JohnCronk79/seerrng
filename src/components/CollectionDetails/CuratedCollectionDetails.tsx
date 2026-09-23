import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import ThreeItemScroll from '@app/components/Common/ThreeItemScroll';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import MediaQualitySelect from '@app/components/MediaDetails/MediaQualitySelect';
import MusicRatings from '@app/components/MediaDetails/MusicRatings';
import useCollectionAvailability from '@app/hooks/useCollectionAvailability';
import useCuratedPosters from '@app/hooks/useCuratedPosters';
import useCuratedRatings from '@app/hooks/useCuratedRatings';
import {
  getCollectionMemberRatings,
  type CollectionRating,
} from '@app/utils/collectionRatings';
import {
  curatedPlaybackIds,
  memberHasQuality,
  reconcileCuratedSelection,
} from '@app/utils/curatedCollectionSelection';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import {
  DEFAULT_MUSIC_COLLECTION_FILTERS,
  filterMusicCollection,
  type MusicCollectionFilters,
} from '@app/utils/musicCollectionFilters';
import { averageMusicRatings } from '@app/utils/musicRatings';
import { getSafeHref } from '@app/utils/safeUrl';
import {
  CheckCircleIcon,
  FilmIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type {
  CuratedCollection,
  CuratedCollectionMember,
} from '@server/models/CuratedCollection';
import type { TvDetails } from '@server/models/Tv';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import CollectionOverview from './CollectionOverview';
import CollectionPlayOnDeviceButton from './CollectionPlayOnDeviceButton';
import CollectionRatings from './CollectionRatings';
import CollectionServerActions from './CollectionServerActions';
import CuratedGenreLinks from './CuratedGenreLinks';
import CuratedMemberCard from './CuratedMemberCard';
import DiscographyRequestActions from './DiscographyRequestActions';
import MusicCollectionFilterRow from './MusicCollectionFilterRow';

const messages = defineMessages('components.CuratedCollection', {
  overview: 'Overview',
  genres: 'Genres',
  size: 'Collection Size',
  quality: 'Quality',
  selectAll: 'Select All',
  selectNone: 'Clear Selection',
  allHelp: 'Select every item for playback and initial collection creation.',
  visibleHelp:
    'Select all shown items for playback and collection creation. Hidden items are not selected.',
  noMatches: 'No items match these filters.',
  noneHelp: 'Clear the shared playback and collection selection.',
  failed: 'This collection could not be loaded. Try again.',
  retry: 'Retry',
  noPlayback: 'No selected items are available in this quality.',
  trailer: 'Watch Trailer',
  trailerHelp: 'Watch the trailer for the first series in this collection.',
  noTrailer: 'No trailer is available for the first series.',
  source: 'Collection Source',
  sourceHelp: 'Open the source catalogue in a new browser window.',
  empty: 'No collection members are listed by the provider.',
  discography: '{artist} Discography',
  ratings:
    'Average of {count} rated albums out of {total}; missing ratings are excluded.',
});

export default function CuratedCollectionDetails({
  kind,
  id,
  discographyArtist,
  returnAlbumId,
}: {
  kind: 'tv' | 'music';
  id: string;
  discographyArtist?: string;
  returnAlbumId?: string;
}) {
  const intl = useIntl();
  const endpoint = `/api/v1/collection-catalog/${kind}/${encodeURIComponent(id)}`;
  const { data, error, mutate } = useSWR<CuratedCollection>(
    id ? endpoint : null
  );
  const isDiscography = discographyArtist !== undefined;
  const availability = useCollectionAvailability(
    isDiscography ? '' : id,
    data,
    kind
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [filters, setFilters] = useState<MusicCollectionFilters>({
    ...DEFAULT_MUSIC_COLLECTION_FILTERS,
  });
  const [quality, setQuality] = useState<'standard' | 'high'>('standard');
  useEffect(() => {
    setManual(false);
    setSelected([]);
    setQuality('standard');
    setFilters({ ...DEFAULT_MUSIC_COLLECTION_FILTERS });
  }, [kind, id]);
  const ids = data?.parts.map((part) => part.id).join(',') ?? '';
  const visibleParts =
    kind === 'music'
      ? filterMusicCollection(data?.parts ?? [], filters)
      : (data?.parts ?? []);
  const visibleIds = visibleParts.map((part) => part.id).join(',');
  // Intersect during render as well: no action can submit a stale hidden selection.
  const shownSelection = selected.filter((memberId) =>
    visibleParts.some((part) => part.id === memberId)
  );
  const changeFilters = (next: MusicCollectionFilters) => {
    setFilters(next);
    void retryRatings();
    retryPosters();
    setManual(true);
    const shown = new Set(
      filterMusicCollection(data?.parts ?? [], next).map((part) => part.id)
    );
    setSelected((current) => current.filter((memberId) => shown.has(memberId)));
  };
  useEffect(() => {
    setSelected((current) =>
      reconcileCuratedSelection(
        visibleIds ? visibleIds.split(',') : [],
        current,
        manual
      )
    );
  }, [visibleIds, manual]);
  const {
    members,
    loading: loadingMembers,
    complete: ratingsComplete,
    retry: retryRatings,
  } = useCuratedRatings(kind, id, ids ? ids.split(',') : []);
  const {
    posters,
    complete: postersComplete,
    retry: retryPosters,
  } = useCuratedPosters(
    kind === 'music' ? id : '',
    kind === 'music' ? (data?.parts ?? []) : []
  );
  const first = data?.parts[0];
  const { data: firstShow } = useSWR<TvDetails>(
    kind === 'tv' && first ? `/api/v1/tv/${first.id}` : null
  );
  const trailer = firstShow?.relatedVideos?.find(
    (video) => video.type === 'Trailer'
  );
  const trailerUrl = getSafeHref(
    trailer?.url ??
      (trailer?.site === 'YouTube'
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`
        : '')
  );
  if (!data)
    return error ? (
      <div role="alert">
        <p>{intl.formatMessage(messages.failed)}</p>
        <Button onClick={() => void mutate()}>
          {intl.formatMessage(messages.retry)}
        </Button>
      </div>
    ) : (
      <LoadingSpinner />
    );
  const parts = data.parts;
  const displayName = isDiscography
    ? intl.formatMessage(messages.discography, {
        artist: discographyArtist || data.name.replace(/ Collection$/, ''),
      })
    : data.name;
  const playbackIds = curatedPlaybackIds(
    visibleParts,
    shownSelection,
    kind,
    quality === 'high'
  );
  const memberRatings = (part: CuratedCollectionMember) =>
    getCollectionMemberRatings(
      {
        id: Number(part.id),
        voteAverage: part.voteAverage ?? 0,
        voteCount: part.voteCount ?? 0,
      },
      members?.find((member) => member.id === part.id)?.ratings
    )
      .filter((rating) => rating.source !== 'imdb')
      .map((rating) =>
        rating.source === 'tmdb'
          ? { ...rating, href: `https://www.themoviedb.org/tv/${part.id}` }
          : rating
      );
  const averages: CollectionRating[] = (
    ['critics', 'audience', 'tmdb'] as const
  ).map((source) => {
    const values = parts.flatMap((part) =>
      memberRatings(part)
        .filter(
          (rating) => rating.source === source && rating.value !== undefined
        )
        .map((rating) => rating.value!)
    );
    return {
      source,
      count: values.length,
      value: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : undefined,
    };
  });
  const musicAverages = averageMusicRatings(
    members.map(
      (member) =>
        member.musicRatings ?? (member.musicRating ? [member.musicRating] : [])
    )
  );
  const toggle = (memberId: string) => {
    setManual(true);
    setSelected((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId]
    );
  };
  return (
    <>
      <PageTitle title={displayName} />
      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {(kind === 'music' ? data.posterPath : data.backdropPath) && (
          <MediaDetailArtwork
            type={kind === 'music' ? 'music' : 'tmdb'}
            src={
              kind === 'music'
                ? data.posterPath!
                : `https://image.tmdb.org/t/p/original${data.backdropPath}`
            }
          />
        )}
        <div className="card-stack relative z-10">
          <div className="detail-item-surface detail-summary-card collection-summary-header">
            <div className="collection-summary-poster">
              <CachedImage
                type={kind === 'music' ? 'music' : 'tmdb'}
                src={
                  (kind === 'music'
                    ? data.posterPath
                    : getTmdbPosterImageUrl(first?.posterPath)) ||
                  '/images/seerr_poster_not_found.png'
                }
                alt=""
                fill
                sizes="80px"
                className="collection-summary-poster-image"
              />
            </div>
            <div className="collection-summary-details">
              <h1 className="collection-summary-title">{displayName}</h1>
              <dl className="collection-summary-table detail-card-heading-spacing">
                <dt className="collection-summary-overview-label">
                  {intl.formatMessage(messages.overview)}:
                </dt>
                <dd className="collection-summary-overview-value">
                  <CollectionOverview
                    text={data.overview || '—'}
                    source={data.overviewSource}
                  />
                </dd>
                <dt className="collection-summary-genres-label">
                  {intl.formatMessage(messages.genres)}:
                </dt>
                <dd className="collection-summary-genres-value">
                  <CuratedGenreLinks kind={kind} parts={parts} />
                </dd>
                <div className="collection-summary-size">
                  <dt className="collection-summary-size-label">
                    {intl.formatMessage(messages.size)}:
                  </dt>
                  <dd className="collection-summary-size-value">
                    {parts.length}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          {!isDiscography && (
            <div className="media-rating-row">
              <MediaQualitySelect
                value={quality}
                onChange={setQuality}
                label={intl.formatMessage(messages.quality)}
                autoSelectAvailable={false}
                options={[
                  {
                    label: kind === 'music' ? 'MP3' : 'HD',
                    value: 'standard',
                    disabled: !parts.some((part) =>
                      memberHasQuality(part, kind, false)
                    ),
                  },
                  {
                    label: kind === 'music' ? 'FLAC' : '4K',
                    value: 'high',
                    disabled: !parts.some((part) =>
                      memberHasQuality(part, kind, true)
                    ),
                  },
                ]}
              />
              <MediaServerPlayButton
                collectionMediaIds={playbackIds}
                defaultIs4k={quality === 'high'}
                disabled={!playbackIds.length}
                disabledReason={
                  !playbackIds.length
                    ? intl.formatMessage(messages.noPlayback)
                    : undefined
                }
              />
              <CollectionPlayOnDeviceButton
                mediaIds={playbackIds}
                is4k={quality === 'high'}
                disabledReason={
                  !playbackIds.length
                    ? intl.formatMessage(messages.noPlayback)
                    : undefined
                }
              />
              {kind === 'tv' ? (
                <CollectionRatings
                  ratings={averages}
                  total={parts.length}
                  loading={loadingMembers && !members.length}
                />
              ) : (
                <MusicRatings ratings={musicAverages} total={parts.length} />
              )}
            </div>
          )}
          {isDiscography && (
            <div className="discography-ratings">
              <MusicRatings ratings={musicAverages} total={parts.length} />
            </div>
          )}
          <div
            className={[
              'media-detail-disclosure-row',
              'collection-detail-disclosure-row',
              kind === 'music' ? 'music-collection-action-row' : '',
              isDiscography ? 'discography-selection-row' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Button
              buttonType={kind === 'music' ? 'association' : 'ghost'}
              title={
                isDiscography
                  ? intl.formatMessage(messages.selectAll)
                  : intl.formatMessage(
                      kind === 'music' ? messages.visibleHelp : messages.allHelp
                    )
              }
              onClick={() => {
                setManual(true);
                setSelected(visibleParts.map((part) => part.id));
              }}
            >
              <CheckCircleIcon />
              <span>{intl.formatMessage(messages.selectAll)}</span>
            </Button>
            <Button
              buttonType={kind === 'music' ? 'association' : 'ghost'}
              title={intl.formatMessage(
                isDiscography ? messages.selectNone : messages.noneHelp
              )}
              onClick={() => {
                setManual(true);
                setSelected([]);
              }}
            >
              <XMarkIcon />
              <span>{intl.formatMessage(messages.selectNone)}</span>
            </Button>
            {kind === 'tv' && (
              <Button
                buttonType="trailer"
                disabled={!trailerUrl}
                disabledReason={intl.formatMessage(messages.noTrailer)}
                title={intl.formatMessage(messages.trailerHelp)}
                onClick={() =>
                  trailerUrl &&
                  window.open(trailerUrl, '_blank', 'noopener,noreferrer')
                }
              >
                <FilmIcon />
                <span>{intl.formatMessage(messages.trailer)}</span>
              </Button>
            )}
            {isDiscography ? (
              <DiscographyRequestActions
                items={visibleParts.filter((part) =>
                  shownSelection.includes(part.id)
                )}
                returnHref={
                  returnAlbumId ? `/music/${returnAlbumId}` : `/artist/${id}`
                }
              />
            ) : (
              <CollectionServerActions
                id={id}
                title={data.name}
                endpoint={endpoint}
                selectedIds={shownSelection}
                availability={availability.data}
                error={availability.error}
                revalidate={availability.mutate}
              />
            )}
          </div>
          {kind === 'music' && (
            <MusicCollectionFilterRow
              parts={parts}
              filters={filters}
              onChange={changeFilters}
              loading={loadingMembers || !ratingsComplete || !postersComplete}
              selectedCount={shownSelection.length}
              totalCount={parts.length}
            />
          )}
          {!parts.length ? (
            <p>{intl.formatMessage(messages.empty)}</p>
          ) : !visibleParts.length ? (
            <p role="status">{intl.formatMessage(messages.noMatches)}</p>
          ) : (
            <ThreeItemScroll label={displayName}>
              {visibleParts.map((part) => (
                <CuratedMemberCard
                  key={part.id}
                  part={{
                    ...part,
                    posterPath: posters[part.id] ?? part.posterPath,
                  }}
                  kind={kind}
                  selected={shownSelection.includes(part.id)}
                  selectionLabel={isDiscography ? part.title : undefined}
                  toggle={() => toggle(part.id)}
                  ratings={
                    kind === 'tv' ? (
                      <CollectionRatings
                        ratings={memberRatings(part)}
                        loading={loadingMembers && !members.length}
                      />
                    ) : (
                      <MusicRatings
                        ratings={
                          members.find((member) => member.id === part.id)
                            ?.musicRatings
                        }
                        albumId={part.id}
                        albumTitle={part.title}
                        artist={part.network}
                      />
                    )
                  }
                />
              ))}
            </ThreeItemScroll>
          )}
          {!isDiscography && (
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={intl.formatMessage(messages.sourceHelp)}
            >
              {intl.formatMessage(messages.source)}
            </a>
          )}
        </div>
      </article>
    </>
  );
}
