import RTAudFresh from '@app/assets/rt_aud_fresh.svg';
import RTAudRotten from '@app/assets/rt_aud_rotten.svg';
import RTFresh from '@app/assets/rt_fresh.svg';
import RTRotten from '@app/assets/rt_rotten.svg';
import ImdbLogo from '@app/assets/services/imdb.svg';
import TmdbLogo from '@app/assets/tmdb_logo.svg';
import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import ExpandableCreditList from '@app/components/MediaDetails/ExpandableCreditList';
import MediaSlider from '@app/components/MediaSlider';
import useLocale from '@app/hooks/useLocale';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import type { RatingResponse } from '@server/api/ratings';
import { MediaStatus } from '@server/constants/media';
import type { MovieDetails } from '@server/models/Movie';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MovieDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  director: 'Director',
  screenplay: 'Screenplay',
  studio: 'Studio',
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
  movieDetails: 'Movie Details',
  status: 'Status',
  releaseDates: 'Release Dates',
  revenue: 'Revenue',
  budget: 'Budget',
  language: 'Language',
  country: 'Country',
  studios: 'Studios',
  notAvailable: 'Not available',
  minutes: '{minutes} minutes',
  recommendations: 'Recommendations',
  similar: 'Similar Titles',
  rtCriticsScore: 'Rotten Tomatoes Tomatometer',
  rtAudienceScore: 'Rotten Tomatoes Audience Score',
  imdbUserScore: 'IMDB User Score – votes: {formattedCount}',
  tmdbUserScore: 'TMDB User Score',
  theatrical: 'Theatrical',
  digital: 'Digital',
  physical: 'Physical',
});

interface MovieDetailsLayoutProps {
  data: MovieDetails;
  ratingData?: RatingResponse;
  sortedCrew: MovieDetails['credits']['crew'];
  filteredReleases: {
    type: number;
    release_date: string;
  }[];
  show4kAvailability: boolean;
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

const MovieDetailsLayout = ({
  data,
  ratingData,
  sortedCrew,
  filteredReleases,
  show4kAvailability,
  primaryActions,
  secondaryActions,
}: MovieDetailsLayoutProps) => {
  const intl = useIntl();
  const { locale } = useLocale();
  const [showCast, setShowCast] = useState(false);
  const [showCrew, setShowCrew] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const unavailable = intl.formatMessage(messages.notAvailable);
  const directors = sortedCrew.filter((person) => person.job === 'Director');
  const screenplay = sortedCrew.find((person) =>
    ['Screenplay', 'Writer', 'Story'].includes(person.job)
  );
  const featuredCrew = sortedCrew.slice(0, 6);
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
  const displayedReleases =
    filteredReleases.length > 0
      ? filteredReleases.slice(0, 3)
      : data.releaseDate
        ? [{ type: 3, release_date: data.releaseDate }]
        : [];
  const releaseTypeLabel = (type: number) =>
    intl.formatMessage(
      type === 4
        ? messages.digital
        : type === 5
          ? messages.physical
          : messages.theatrical
    );
  const formatCurrency = (value: number) =>
    value > 0
      ? intl.formatNumber(value, { currency: 'USD', style: 'currency' })
      : unavailable;
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
  const mediaAndFormat = `Movie${availableFormats.length > 0 ? ` · ${availableFormats.join(' + ')}` : ''}`;

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
            {data.title}
            {data.releaseDate ? ` (${data.releaseDate.slice(0, 4)})` : ''}
          </h1>

          <div className="mt-4 grid min-w-0 grid-cols-1 card:grid-cols-3">
            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.mediaAndFormat)}:
              </dt>
              <dd className="m-0 truncate">{mediaAndFormat}</dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.releaseDate)}:
              </dt>
              <dd className="m-0 truncate">
                {data.releaseDate
                  ? intl.formatDate(data.releaseDate, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })
                  : unavailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.runtime)}:
              </dt>
              <dd className="m-0 truncate">
                {data.runtime
                  ? intl.formatMessage(messages.minutes, {
                      minutes: data.runtime,
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
                          href={`/discover/movies?genre=${genre.id}`}
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
                {intl.formatMessage(messages.director)}:
              </dt>
              <dd className="m-0 truncate">
                {directors.length > 0
                  ? directors.slice(0, 2).map((person, index) => (
                      <span key={`${person.id}-${person.creditId}`}>
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
                {intl.formatMessage(messages.screenplay)}:
              </dt>
              <dd className="m-0 truncate">
                {screenplay ? (
                  <Link
                    href={`/person/${screenplay.id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {screenplay.name}
                  </Link>
                ) : (
                  unavailable
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.studio)}:
              </dt>
              <dd className="m-0 truncate">
                {data.productionCompanies[0] ? (
                  <Link
                    href={`/discover/movies/studio/${data.productionCompanies[0].id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {data.productionCompanies[0].name}
                  </Link>
                ) : (
                  unavailable
                )}
              </dd>
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
                    className={`grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4 ${groupIndex > 0 ? 'mt-2 border-t border-gray-600 pt-2 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-0 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600' : 'card:pr-3'}`}
                  >
                    {group.map((person) => (
                      <div
                        className="contents"
                        key={`${person.id}-${person.creditId}`}
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

          {(ratingData?.rt?.criticsScore !== undefined ||
            ratingData?.rt?.audienceScore !== undefined ||
            ratingData?.imdb?.criticsScore !== undefined ||
            data.voteCount > 0) && (
            <div className="media-rating-row">
              {ratingData?.rt?.criticsRating &&
                typeof ratingData.rt.criticsScore === 'number' && (
                  <Tooltip
                    content={intl.formatMessage(messages.rtCriticsScore)}
                  >
                    <a
                      href={getSafeHref(ratingData.rt.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="media-rating-link"
                    >
                      {ratingData.rt.criticsRating === 'Rotten' ? (
                        <RTRotten className="media-rating-icon" />
                      ) : (
                        <RTFresh className="media-rating-icon" />
                      )}
                      <span className="media-rating-value">
                        {ratingData.rt.criticsScore}%
                      </span>
                    </a>
                  </Tooltip>
                )}
              {ratingData?.rt?.audienceRating &&
                typeof ratingData.rt.audienceScore === 'number' && (
                  <Tooltip
                    content={intl.formatMessage(messages.rtAudienceScore)}
                  >
                    <a
                      href={getSafeHref(ratingData.rt.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="media-rating-link"
                    >
                      {ratingData.rt.audienceRating === 'Spilled' ? (
                        <RTAudRotten className="media-rating-icon media-rating-icon-audience" />
                      ) : (
                        <RTAudFresh className="media-rating-icon media-rating-icon-audience" />
                      )}
                      <span className="media-rating-value">
                        {ratingData.rt.audienceScore}%
                      </span>
                    </a>
                  </Tooltip>
                )}
              {ratingData?.imdb?.criticsScore !== undefined && (
                <Tooltip
                  content={intl.formatMessage(messages.imdbUserScore, {
                    formattedCount: intl.formatNumber(
                      ratingData.imdb.criticsScoreCount,
                      {
                        notation: 'compact',
                        compactDisplay: 'short',
                        maximumFractionDigits: 1,
                      }
                    ),
                  })}
                >
                  <a
                    href={getSafeHref(ratingData.imdb.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="media-rating-link"
                  >
                    <ImdbLogo className="media-rating-wordmark" />
                    <span className="media-rating-value">
                      {ratingData.imdb.criticsScore}
                    </span>
                  </a>
                </Tooltip>
              )}
              {data.voteCount > 0 && (
                <Tooltip content={intl.formatMessage(messages.tmdbUserScore)}>
                  <a
                    href={`https://www.themoviedb.org/movie/${data.id}?language=${locale}`}
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
                      href={`/discover/movies/keyword?keywords=${keyword.id}`}
                      className={`inline-flex h-[22px] items-center rounded-full border px-2 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${subjectTagTones[keyword.id % subjectTagTones.length]}`}
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
              {intl.formatMessage(messages.movieDetails)}
            </h2>
            <div className="grid grid-cols-1 card:grid-cols-3">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0">{data.status || unavailable}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.releaseDates)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {displayedReleases.length > 0
                    ? displayedReleases.map((release, index) => (
                        <span
                          className="block"
                          key={`${release.type}-${index}`}
                        >
                          {releaseTypeLabel(release.type)} ·{' '}
                          {intl.formatDate(release.release_date, {
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
                  {intl.formatMessage(messages.revenue)}:
                </dt>
                <dd className="m-0 truncate">{formatCurrency(data.revenue)}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.budget)}:
                </dt>
                <dd className="m-0 truncate">{formatCurrency(data.budget)}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.language)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/discover/movies/language/${data.originalLanguage}`}
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
                            href={`/discover/movies?country=${country.iso_3166_1}`}
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
                  {intl.formatMessage(messages.studios)}:
                </dt>
                <dd className="m-0 min-w-0">
                  {data.productionCompanies.length > 0
                    ? data.productionCompanies.slice(0, 4).map((studio) => (
                        <Link
                          key={studio.id}
                          href={`/discover/movies/studio/${studio.id}`}
                          className="block truncate text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        >
                          {studio.name}
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
        url={`/api/v1/movie/${data.id}/recommendations`}
        linkUrl={`/movie/${data.id}/recommendations`}
        hideWhenEmpty
      />
      <MediaSlider
        sliderKey="similar"
        title={intl.formatMessage(messages.similar)}
        url={`/api/v1/movie/${data.id}/similar`}
        linkUrl={`/movie/${data.id}/similar`}
        hideWhenEmpty
      />
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default MovieDetailsLayout;
