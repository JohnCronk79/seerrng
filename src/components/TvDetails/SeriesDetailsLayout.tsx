import RTAudFresh from '@app/assets/rt_aud_fresh.svg';
import RTAudRotten from '@app/assets/rt_aud_rotten.svg';
import RTFresh from '@app/assets/rt_fresh.svg';
import RTRotten from '@app/assets/rt_rotten.svg';
import TmdbLogo from '@app/assets/tmdb_logo.svg';
import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import ExpandableCreditList from '@app/components/MediaDetails/ExpandableCreditList';
import SeriesSeasonEpisodeBrowser from '@app/components/MediaDetails/SeriesSeasonEpisodeBrowser';
import MediaSlider from '@app/components/MediaSlider';
import useLocale from '@app/hooks/useLocale';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import type { RTRating } from '@server/api/rating/rottentomatoes';
import { MediaStatus } from '@server/constants/media';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  firstAirDate: 'First Air Date',
  episodeRuntime: 'Episode Runtime',
  genres: 'Genres',
  creator: 'Creator',
  network: 'Network',
  seriesType: 'Series Type',
  hd: 'HD',
  ultraHd: '4K',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  viewCast: 'View Cast',
  viewCrew: 'View Crew',
  subjectTags: 'Subject Tags',
  fullCastList: 'Full Cast List',
  fullCrewList: 'Full Crew List',
  noCast: 'No cast information available',
  noCrew: 'No crew information available',
  noTags: 'No subject tags available',
  seriesDetails: 'Series Details',
  status: 'Status',
  airDates: 'Air Dates',
  first: 'First',
  last: 'Last',
  next: 'Next',
  language: 'Language',
  country: 'Country',
  networks: 'Networks',
  notAvailable: 'Not available',
  minutes: '{minutes} minutes',
  recommendations: 'Recommendations',
  similar: 'Similar Series',
  rtCriticsScore: 'Rotten Tomatoes Tomatometer',
  rtAudienceScore: 'Rotten Tomatoes Audience Score',
  tmdbUserScore: 'TMDB User Score',
});

interface SeriesDetailsLayoutProps {
  data: TvDetails;
  ratingData?: RTRating;
  sortedCrew: TvDetails['credits']['crew'];
  show4kAvailability: boolean;
  visibleSeasons: TvDetails['seasons'];
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
}

const availableStatuses = new Set([
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.AVAILABLE,
]);

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

const SeriesDetailsLayout = ({
  data,
  ratingData,
  sortedCrew,
  show4kAvailability,
  visibleSeasons,
  primaryActions,
  secondaryActions,
}: SeriesDetailsLayoutProps) => {
  const intl = useIntl();
  const { locale } = useLocale();
  const [showCast, setShowCast] = useState(false);
  const [showCrew, setShowCrew] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const unavailable = intl.formatMessage(messages.notAvailable);
  const creators = data.createdBy;
  const featuredCrew = [
    ...creators.map((person) => ({ ...person, job: 'Creator' })),
    ...sortedCrew,
  ].slice(0, 6);
  const featuredCrewGroups = [0, 1, 2].map((column) =>
    [featuredCrew[column], featuredCrew[column + 3]].filter(Boolean)
  );
  const castCredits = useMemo(
    () =>
      data.credits.cast.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.character,
        profilePath: person.profilePath,
      })),
    [data.credits.cast]
  );
  const crewCredits = useMemo(
    () =>
      data.credits.crew.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.job,
        profilePath: person.profilePath,
      })),
    [data.credits.crew]
  );
  const originalLanguage =
    intl.formatDisplayName(data.originalLanguage, {
      type: 'language',
      fallback: 'none',
    }) ??
    data.spokenLanguages.find(
      (language) => language.iso_639_1 === data.originalLanguage
    )?.name ??
    unavailable;
  const availableFormats = [
    availableStatuses.has(data.mediaInfo?.status as MediaStatus)
      ? 'HD'
      : undefined,
    availableStatuses.has(data.mediaInfo?.status4k as MediaStatus)
      ? '4K'
      : undefined,
  ].filter(Boolean);
  const mediaAndFormat = `Series${
    availableFormats.length > 0 ? ` · ${availableFormats.join(' + ')}` : ''
  }`;
  const airDates = [
    data.firstAirDate
      ? { label: messages.first, value: data.firstAirDate }
      : undefined,
    data.lastAirDate && data.lastAirDate !== data.firstAirDate
      ? { label: messages.last, value: data.lastAirDate }
      : undefined,
    data.nextEpisodeToAir?.airDate &&
    data.nextEpisodeToAir.airDate !== data.lastAirDate
      ? { label: messages.next, value: data.nextEpisodeToAir.airDate }
      : undefined,
  ].filter(
    (item): item is { label: typeof messages.first; value: string } => !!item
  );

  return (
    <div className="media-page">
      <article className="refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 text-gray-400 shadow-lg shadow-gray-950/20">
        {data.backdropPath && (
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/original${data.backdropPath}`}
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
            {data.name}
            {data.firstAirDate ? ` (${data.firstAirDate.slice(0, 4)})` : ''}
          </h1>

          <div className="mt-4 grid min-w-0 grid-cols-1 card:grid-cols-3">
            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.mediaAndFormat)}:
              </dt>
              <dd className="m-0 truncate">{mediaAndFormat}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.firstAirDate)}:
              </dt>
              <dd className="m-0 truncate">
                {data.firstAirDate
                  ? intl.formatDate(data.firstAirDate, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.episodeRuntime)}:
              </dt>
              <dd className="m-0 truncate">
                {data.episodeRunTime[0]
                  ? intl.formatMessage(messages.minutes, {
                      minutes: data.episodeRunTime[0],
                    })
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.genres)}:
              </dt>
              <dd className="m-0 line-clamp-2 min-w-0">
                {data.genres.length > 0
                  ? data.genres.map((genre, index) => (
                      <span key={genre.id}>
                        {index > 0 && ', '}
                        <Link
                          href={`/discover/tv?genre=${genre.id}`}
                          className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          {genre.name}
                        </Link>
                      </span>
                    ))
                  : unavailable}
              </dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.creator)}:
              </dt>
              <dd className="m-0 truncate">
                {creators.length > 0
                  ? creators.slice(0, 2).map((person, index) => (
                      <span key={person.id}>
                        {index > 0 && ', '}
                        <Link
                          href={`/person/${person.id}`}
                          className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          {person.name}
                        </Link>
                      </span>
                    ))
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.network)}:
              </dt>
              <dd className="m-0 truncate">
                {data.networks[0] ? (
                  <Link
                    href={`/discover/tv/network/${data.networks[0].id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {data.networks[0].name}
                  </Link>
                ) : (
                  unavailable
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.seriesType)}:
              </dt>
              <dd className="m-0 truncate">{data.type || unavailable}</dd>
            </dl>

            <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.hd)}:
              </dt>
              <dd className="m-0 truncate">
                {getAvailabilityText(data.mediaInfo?.status, unavailable)}
              </dd>
              {show4kAvailability && (
                <>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.ultraHd)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {getAvailabilityText(data.mediaInfo?.status4k, unavailable)}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <SeriesSeasonEpisodeBrowser tvId={data.id} seasons={visibleSeasons} />

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
            {data.tagline && (
              <p className="mt-1 text-sm italic text-indigo-300">
                {data.tagline}
              </p>
            )}
            <p className="mt-4 text-sm leading-5 text-gray-400">
              {data.overview ||
                intl.formatMessage(messages.overviewUnavailable)}
            </p>

            {featuredCrew.length > 0 && (
              <div className="mt-4 grid grid-cols-1 border-t border-gray-600 pt-3 card:grid-cols-3 card:border-t-0 card:pt-0">
                {featuredCrewGroups.map((group, groupIndex) => (
                  <dl
                    key={`featured-crew-${groupIndex}`}
                    className={`grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4 ${
                      groupIndex > 0
                        ? 'mt-2 border-t border-gray-600 pt-2 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600'
                        : 'card:pr-3'
                    }`}
                  >
                    {group.map((person) => (
                      <div
                        className="contents"
                        key={`${person.id}-${person.job}`}
                      >
                        <dt className="font-medium text-gray-100">
                          {person.job}:
                        </dt>
                        <dd className="m-0 truncate">
                          <Link
                            href={`/person/${person.id}`}
                            className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          >
                            {person.name}
                          </Link>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ))}
              </div>
            )}
          </section>

          {(ratingData?.criticsScore !== undefined ||
            ratingData?.audienceScore !== undefined ||
            data.voteCount > 0) && (
            <div className="media-rating-row">
              {ratingData?.criticsRating &&
                typeof ratingData.criticsScore === 'number' && (
                  <Tooltip
                    content={intl.formatMessage(messages.rtCriticsScore)}
                  >
                    <a
                      href={getSafeHref(ratingData.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="media-rating-link"
                    >
                      {ratingData.criticsRating === 'Rotten' ? (
                        <RTRotten className="media-rating-icon" />
                      ) : (
                        <RTFresh className="media-rating-icon" />
                      )}
                      <span className="media-rating-value">
                        {ratingData.criticsScore}%
                      </span>
                    </a>
                  </Tooltip>
                )}
              {ratingData?.audienceRating &&
                typeof ratingData.audienceScore === 'number' && (
                  <Tooltip
                    content={intl.formatMessage(messages.rtAudienceScore)}
                  >
                    <a
                      href={getSafeHref(ratingData.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="media-rating-link"
                    >
                      {ratingData.audienceRating === 'Spilled' ? (
                        <RTAudRotten className="media-rating-icon media-rating-icon-audience" />
                      ) : (
                        <RTAudFresh className="media-rating-icon media-rating-icon-audience" />
                      )}
                      <span className="media-rating-value">
                        {ratingData.audienceScore}%
                      </span>
                    </a>
                  </Tooltip>
                )}
              {data.voteCount > 0 && (
                <Tooltip content={intl.formatMessage(messages.tmdbUserScore)}>
                  <a
                    href={`https://www.themoviedb.org/tv/${data.id}?language=${locale}`}
                    target="_blank"
                    rel="noreferrer"
                    className="media-rating-link"
                  >
                    <TmdbLogo className="media-rating-wordmark" />
                    <span className="media-rating-value">
                      {Math.round(data.voteAverage * 10)}%
                    </span>
                  </a>
                </Tooltip>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <DetailDisclosureButton
              label={intl.formatMessage(messages.viewCast)}
              open={showCast}
              onClick={() => setShowCast((open) => !open)}
            />
            <DetailDisclosureButton
              label={intl.formatMessage(messages.viewCrew)}
              open={showCrew}
              onClick={() => setShowCrew((open) => !open)}
            />
            <DetailDisclosureButton
              label={intl.formatMessage(messages.subjectTags)}
              open={showTags}
              onClick={() => setShowTags((open) => !open)}
            />
          </div>

          {showCast && (
            <ExpandableCreditList
              title={intl.formatMessage(messages.fullCastList)}
              credits={castCredits}
              emptyLabel={intl.formatMessage(messages.noCast)}
            />
          )}
          {showCrew && (
            <ExpandableCreditList
              title={intl.formatMessage(messages.fullCrewList)}
              credits={crewCredits}
              emptyLabel={intl.formatMessage(messages.noCrew)}
            />
          )}
          {showTags && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.subjectTags)}
              </h2>
              {data.keywords.length === 0 ? (
                <p className="text-xs text-gray-500">
                  {intl.formatMessage(messages.noTags)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.keywords.map((keyword) => (
                    <Link
                      key={keyword.id}
                      href={`/discover/tv/keyword?keywords=${keyword.id}`}
                      className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                        subjectTagTones[keyword.id % subjectTagTones.length]
                      }`}
                    >
                      {keyword.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="mb-3 text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.seriesDetails)}
            </h2>
            <div className="grid grid-cols-1 card:grid-cols-3">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0">{data.status || unavailable}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.airDates)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {airDates.length > 0
                    ? airDates.map((airDate) => (
                        <span className="block" key={airDate.label.id}>
                          {intl.formatMessage(airDate.label)} ·{' '}
                          {intl.formatDate(airDate.value, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </span>
                      ))
                    : unavailable}
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:px-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.seriesType)}:
                </dt>
                <dd className="m-0 truncate">{data.type || unavailable}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.episodeRuntime)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.episodeRunTime[0]
                    ? intl.formatMessage(messages.minutes, {
                        minutes: data.episodeRunTime[0],
                      })
                    : unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.language)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/discover/tv/language/${data.originalLanguage}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {originalLanguage}
                  </Link>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.country)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {data.productionCountries.length > 0
                    ? data.productionCountries.map((country, index) => (
                        <span key={country.iso_3166_1}>
                          {index > 0 && ', '}
                          <Link
                            href={`/discover/tv?country=${country.iso_3166_1}`}
                            className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          >
                            {intl.formatDisplayName(country.iso_3166_1, {
                              type: 'region',
                              fallback: 'none',
                            }) ?? country.name}
                          </Link>
                        </span>
                      ))
                    : unavailable}
                </dd>
              </dl>

              <dl className="mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.networks)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {data.networks.length > 0
                    ? data.networks.slice(0, 4).map((network) => (
                        <Link
                          key={network.id}
                          href={`/discover/tv/network/${network.id}`}
                          className="block truncate text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          {network.name}
                        </Link>
                      ))
                    : unavailable}
                </dd>
              </dl>
            </div>
          </section>
        </div>
      </article>

      <MediaSlider
        sliderKey="recommendations"
        title={intl.formatMessage(messages.recommendations)}
        url={`/api/v1/tv/${data.id}/recommendations`}
        linkUrl={`/tv/${data.id}/recommendations`}
        hideWhenEmpty
      />
      <MediaSlider
        sliderKey="similar"
        title={intl.formatMessage(messages.similar)}
        url={`/api/v1/tv/${data.id}/similar`}
        linkUrl={`/tv/${data.id}/similar`}
        hideWhenEmpty
      />
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default SeriesDetailsLayout;
