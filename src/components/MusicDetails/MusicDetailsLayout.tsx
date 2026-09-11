import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import AlbumTrackList from '@app/components/MediaDetails/AlbumTrackList';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import MediaSlider from '@app/components/MediaSlider';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import type { MusicDetails } from '@server/models/Music';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MusicDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  status: 'Status',
  viewArtists: 'View Artists',
  subjectTags: 'Subject Tags',
  fullArtistList: 'Full Artist List',
  noArtists: 'No artist information available',
  noTags: 'No subject tags available',
  albumDetails: 'Album Details',
  artistType: 'Artist Type',
  origin: 'Origin',
  musicBrainz: 'MusicBrainz',
  similarArtists: 'Similar Artists',
  notAvailable: 'Not available',
  minutes: '{minutes} minutes',
  available: 'Available',
  albumArtist: 'Album Artist',
  trackArtist: 'Track Artist',
});

interface MusicDetailsLayoutProps {
  data: MusicDetails;
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
  additionalContent?: ReactNode;
}

const getAvailabilityText = (
  status: MediaStatus | undefined,
  unavailable: string
) => {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return 'Available';
    case MediaStatus.PARTIALLY_AVAILABLE:
      return 'Partially Available';
    case MediaStatus.PROCESSING:
      return 'Processing';
    case MediaStatus.PENDING:
      return 'Requested';
    case MediaStatus.BLOCKLISTED:
      return 'Blocklisted';
    default:
      return unavailable;
  }
};

const subjectTagTones = [
  'border-indigo-400/80 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/35',
  'border-purple-400/80 bg-purple-500/20 text-purple-100 hover:bg-purple-500/35',
  'border-emerald-400/80 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35',
  'border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35',
  'border-sky-400/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/35',
  'border-rose-400/80 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35',
] as const;

const MusicDetailsLayout = ({
  data,
  primaryActions,
  secondaryActions,
  additionalContent,
}: MusicDetailsLayoutProps) => {
  const intl = useIntl();
  const [showArtists, setShowArtists] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const unavailable = intl.formatMessage(messages.notAvailable);
  const albumId = encodeApiPathSegment(data.id);
  const artistId = encodeApiPathSegment(data.artist.id);
  const formattedReleaseDate = (() => {
    if (!data.releaseDate) {
      return unavailable;
    }
    if (/^\d{4}$/.test(data.releaseDate)) {
      return data.releaseDate;
    }
    const normalizedDate = /^\d{4}-\d{2}$/.test(data.releaseDate)
      ? `${data.releaseDate}-01`
      : data.releaseDate;
    const parsedDate = new Date(`${normalizedDate}T00:00:00Z`);

    return Number.isNaN(parsedDate.getTime())
      ? data.releaseDate
      : intl.formatDate(parsedDate, {
          year: 'numeric',
          month: 'short',
          day: /^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate)
            ? 'numeric'
            : undefined,
          timeZone: 'UTC',
        });
  })();
  const runtimeMinutes = Math.round(
    data.tracks.reduce((total, track) => total + track.length, 0) / 60000
  );
  const qualityLabels = [
    ...new Set(
      (data.availableServices ?? [])
        .map((service) => service.quality.trim().toLocaleUpperCase())
        .filter(Boolean)
    ),
  ];
  const mediaAndFormat = `Music · Album${
    qualityLabels.length > 0 ? ` · ${qualityLabels.join(' + ')}` : ''
  }`;
  const tags = useMemo(() => {
    const uniqueTags = new Map<string, { name: string; count: number }>();
    for (const tag of [
      ...(data.tags?.releaseGroup ?? []),
      ...(data.tags?.artist ?? []),
    ]) {
      const name = tag.tag.trim();
      if (!name) {
        continue;
      }
      const key = name.toLocaleLowerCase();
      const count = Number.isFinite(tag.count) ? tag.count : 0;
      const existing = uniqueTags.get(key);
      if (!existing || count > existing.count) {
        uniqueTags.set(key, { name, count });
      }
    }
    return [...uniqueTags.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [data.tags]);
  const artists = useMemo(() => {
    const uniqueArtists = new Map<
      string,
      {
        id: string;
        name: string;
        role: string;
        image?: string;
        imageType: 'music' | 'tmdb';
      }
    >();

    if (data.artist.id && data.artist.name) {
      uniqueArtists.set(data.artist.id, {
        id: data.artist.id,
        name: data.artist.name,
        role: intl.formatMessage(messages.albumArtist),
        image: data.artistThumb,
        imageType: 'music',
      });
    }
    for (const track of data.tracks) {
      for (const artist of track.artists) {
        if (!artist.mbid || !artist.name || uniqueArtists.has(artist.mbid)) {
          continue;
        }
        uniqueArtists.set(artist.mbid, {
          id: artist.mbid,
          name: artist.name,
          role: intl.formatMessage(messages.trackArtist),
          image: artist.tmdbMapping?.profilePath,
          imageType: 'tmdb',
        });
      }
    }
    return [...uniqueArtists.values()];
  }, [data.artist, data.artistThumb, data.tracks, intl]);
  const backdrop = data.artistBackdrop ?? data.artistThumb ?? data.posterPath;

  return (
    <div className="media-page">
      <article className="refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 text-gray-400 shadow-lg shadow-gray-950/20">
        {backdrop && (
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <CachedImage
              type="music"
              src={backdrop}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover object-top"
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
            {data.releaseDate ? ` (${data.releaseDate.slice(0, 4)})` : ''}
          </h1>

          {qualityLabels.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {qualityLabels.map((quality, index) => (
                <span
                  key={quality}
                  className={`inline-flex h-[22px] cursor-default items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold uppercase leading-none ${subjectTagTones[index % subjectTagTones.length]}`}
                >
                  {quality}
                </span>
              ))}
              <Badge
                badgeType="success"
                className="h-[22px] items-center !px-2 !text-[11px] !leading-none"
              >
                {intl.formatMessage(messages.available)}
              </Badge>
            </div>
          )}

          <div className="mt-4 grid min-w-0 grid-cols-1 card:grid-cols-3">
            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.mediaAndFormat)}:
              </dt>
              <dd className="m-0 truncate">{mediaAndFormat}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.releaseDate)}:
              </dt>
              <dd className="m-0 truncate">{formattedReleaseDate}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.runtime)}:
              </dt>
              <dd className="m-0 truncate">
                {runtimeMinutes > 0
                  ? intl.formatMessage(messages.minutes, {
                      minutes: runtimeMinutes,
                    })
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.genres)}:
              </dt>
              <dd className="m-0 line-clamp-2 min-w-0">
                {tags.length > 0
                  ? tags.slice(0, 4).map((tag, index) => (
                      <span key={tag.name}>
                        {index > 0 && ', '}
                        <Link
                          href={`/discover/music?genre=${encodeURIComponent(tag.name)}`}
                          className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          {tag.name}
                        </Link>
                      </span>
                    ))
                  : unavailable}
              </dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.artist)}:
              </dt>
              <dd className="m-0 truncate">
                <Link
                  href={`/artist/${artistId}`}
                  className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {data.artist.name || unavailable}
                </Link>
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.albumType)}:
              </dt>
              <dd className="m-0 truncate">{data.type || unavailable}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.trackCount)}:
              </dt>
              <dd className="m-0 truncate">
                {intl.formatNumber(data.tracks.length)}
              </dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              {qualityLabels.length > 0 ? (
                qualityLabels.map((quality) => (
                  <div className="contents" key={quality}>
                    <dt className="font-medium uppercase text-gray-100">
                      {quality}:
                    </dt>
                    <dd className="m-0 truncate">
                      {intl.formatMessage(messages.available)}
                    </dd>
                  </div>
                ))
              ) : (
                <>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.status)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {getAvailabilityText(data.mediaInfo?.status, unavailable)}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <AlbumTrackList tracks={data.tracks} twoColumnsOnly />

          <div className="mt-[5px] flex flex-wrap items-center justify-start gap-2">
            {primaryActions}
          </div>
          <div className="mt-[5px] flex flex-wrap items-center justify-end gap-2">
            {secondaryActions}
          </div>

          <div className="mt-[5px] flex flex-wrap items-center gap-2">
            <DetailDisclosureButton
              label={intl.formatMessage(messages.viewArtists)}
              open={showArtists}
              onClick={() => setShowArtists((open) => !open)}
            />
            <DetailDisclosureButton
              label={intl.formatMessage(messages.subjectTags)}
              open={showTags}
              onClick={() => setShowTags((open) => !open)}
            />
          </div>

          {showArtists && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.fullArtistList)}
              </h2>
              {artists.length === 0 ? (
                <p className="text-xs text-gray-500">
                  {intl.formatMessage(messages.noArtists)}
                </p>
              ) : (
                <div className="grid max-h-[252px] grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                  {artists.map((artist) => (
                    <Link
                      key={artist.id}
                      href={`/artist/${encodeApiPathSegment(artist.id)}`}
                      prefetch={false}
                      className="group flex h-20 min-w-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-900/30 transition hover:border-indigo-400 hover:bg-indigo-500/15 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <span className="relative h-full w-[54px] flex-shrink-0 overflow-hidden border-r border-gray-700 bg-white">
                        <CachedImage
                          type={artist.imageType}
                          src={
                            artist.image
                              ? artist.imageType === 'tmdb' &&
                                artist.image.startsWith('/')
                                ? `https://image.tmdb.org/t/p/w185${artist.image}`
                                : artist.image
                              : '/images/camera-shy-profile-placeholder.png'
                          }
                          alt=""
                          fill
                          sizes="54px"
                          className="object-cover object-top"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5">
                        <span className="truncate text-xs font-semibold text-gray-200 group-hover:text-white">
                          {artist.name}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-gray-400">
                          {artist.role}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {showTags && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.subjectTags)}
              </h2>
              {tags.length === 0 ? (
                <p className="text-xs text-gray-500">
                  {intl.formatMessage(messages.noTags)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag, index) => (
                    <Link
                      key={tag.name}
                      href={`/discover/music?genre=${encodeURIComponent(tag.name)}`}
                      className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                        subjectTagTones[index % subjectTagTones.length]
                      }`}
                    >
                      {tag.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="mb-3 text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.albumDetails)}
            </h2>
            <div className="grid grid-cols-1 card:grid-cols-3">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0">
                  {getAvailabilityText(data.mediaInfo?.status, unavailable)}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.releaseDate)}:
                </dt>
                <dd className="m-0 truncate">{formattedReleaseDate}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.musicBrainz)}:
                </dt>
                <dd className="m-0 truncate">
                  <a
                    href={`https://musicbrainz.org/release-group/${albumId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {data.mbId}
                  </a>
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.albumType)}:
                </dt>
                <dd className="m-0 truncate">{data.type || unavailable}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.runtime)}:
                </dt>
                <dd className="m-0 truncate">
                  {runtimeMinutes > 0
                    ? intl.formatMessage(messages.minutes, {
                        minutes: runtimeMinutes,
                      })
                    : unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.trackCount)}:
                </dt>
                <dd className="m-0 truncate">
                  {intl.formatNumber(data.tracks.length)}
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.artist)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/artist/${artistId}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {data.artist.name || unavailable}
                  </Link>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.artistType)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.artist.type || unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.origin)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.artist.area ? (
                    <a
                      href={`https://musicbrainz.org/search?query=${encodeURIComponent(
                        data.artist.area
                      )}&type=area&method=indexed`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      {data.artist.area}
                    </a>
                  ) : (
                    unavailable
                  )}
                </dd>
              </dl>
            </div>
          </section>
          {additionalContent}
        </div>
      </article>

      <MediaSlider
        sliderKey="similar-artists"
        title={intl.formatMessage(messages.similarArtists)}
        url={`/api/v1/music/${albumId}/artist-similar`}
        hideWhenEmpty
      />
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default MusicDetailsLayout;
