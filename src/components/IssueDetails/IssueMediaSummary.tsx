import CachedImage from '@app/components/Common/CachedImage';
import { getIssueMediaAndFormatLabel } from '@app/components/IssueDetails/issueMediaFormat';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';

export type IssueMediaDetails =
  | MovieDetails
  | TvDetails
  | MusicDetails
  | BookDetails;

export type IssueSummaryDetail = {
  label?: string;
  value: ReactNode;
};

type LinkedValue = { label: string; href?: string };
type SummaryRow = { label: string; values: LinkedValue[] };

export const isIssueMusic = (media: IssueMediaDetails): media is MusicDetails =>
  (media as MusicDetails).mediaType === 'album';

export const isIssueBook = (media: IssueMediaDetails): media is BookDetails =>
  (media as BookDetails).mediaType === 'book';

export const isIssueMovie = (media: IssueMediaDetails): media is MovieDetails =>
  !isIssueMusic(media) &&
  !isIssueBook(media) &&
  (media as MovieDetails).title !== undefined;

const linkedValues = (values: LinkedValue[]) =>
  values.map((value, index) => (
    <span key={`${value.label}-${index}`}>
      {index > 0 && ', '}
      {value.href ? (
        <Link
          href={value.href}
          className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {value.label}
        </Link>
      ) : (
        value.label
      )}
    </span>
  ));

interface IssueMediaSummaryProps {
  data: IssueMediaDetails;
  mediaType: 'movie' | 'tv' | 'music' | 'book';
  is4k?: boolean;
  mediaHref?: string;
  artwork?: string;
  rightDetails: IssueSummaryDetail[];
  footer?: ReactNode;
}

const IssueMediaSummary = ({
  data,
  mediaType,
  is4k = false,
  mediaHref,
  artwork,
  rightDetails,
  footer,
}: IssueMediaSummaryProps) => {
  const intl = useIntl();
  const unavailable = 'Not available';
  const isMovie = isIssueMovie(data);
  const isMusic = isIssueMusic(data);
  const isBook = isIssueBook(data);
  const title = isMovie || isMusic || isBook ? data.title : data.name;
  const releaseDate = isMovie
    ? data.releaseDate
    : isMusic
      ? data.releaseDate
      : isBook
        ? data.firstPublishYear?.toString()
        : data.firstAirDate;
  const releaseYear = releaseDate?.match(/^\d{4}/)?.[0];
  const runtime = isBook
    ? data.numberOfPages
      ? intl.formatNumber(data.numberOfPages)
      : unavailable
    : isMusic
      ? data.tracks.length > 0
        ? `${intl.formatNumber(
            Math.round(
              data.tracks.reduce((total, track) => total + track.length, 0) /
                60000
            )
          )} minutes`
        : unavailable
      : isMovie
        ? data.runtime
          ? `${intl.formatNumber(data.runtime)} minutes`
          : unavailable
        : data.episodeRunTime[0]
          ? `${intl.formatNumber(data.episodeRunTime[0])} minutes`
          : unavailable;
  const posterSrc =
    isMusic || isBook
      ? data.posterPath || '/images/seerr_poster_not_found.png'
      : getTmdbPosterImageUrl(data.posterPath) ||
        '/images/seerr_poster_not_found.png';
  const posterType = isBook ? 'book' : isMusic ? 'music' : 'tmdb';
  const artworkSrc =
    artwork ??
    (isMusic
      ? data.artistBackdrop || data.posterPath
      : isBook
        ? data.posterPath
        : data.backdropPath
          ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.backdropPath}`
          : posterSrc);
  const artworkType = isBook ? 'book' : isMusic ? 'music' : 'tmdb';
  const mediaLabel = getIssueMediaAndFormatLabel(mediaType, is4k);
  const secondaryRows: SummaryRow[] = isMovie
    ? [
        ...sortCrewPriority(data.credits.crew)
          .slice(0, 2)
          .map((person) => ({
            label: person.job,
            values: [
              {
                label: person.name,
                href: person.id ? `/person/${person.id}` : undefined,
              },
            ],
          })),
        {
          label: 'Studio',
          values: [
            {
              label: data.productionCompanies[0]?.name ?? unavailable,
              href: data.productionCompanies[0]?.id
                ? `/discover/movies/studio/${data.productionCompanies[0].id}`
                : undefined,
            },
          ],
        },
      ]
    : isMusic
      ? [
          {
            label: 'Artist',
            values: [
              {
                label: data.artist.name,
                href: data.artist.id
                  ? `/artist/${encodeApiPathSegment(
                      normalizeMusicBrainzId(data.artist.id)
                    )}`
                  : undefined,
              },
            ],
          },
          { label: 'Album Type', values: [{ label: data.type }] },
          {
            label: 'Track Count',
            values: [{ label: intl.formatNumber(data.tracks.length) }],
          },
        ]
      : isBook
        ? [
            {
              label: 'Author',
              values: [
                {
                  label: data.author ?? unavailable,
                  href: data.authorId
                    ? `/author/${encodeApiPathSegment(data.authorId)}`
                    : undefined,
                },
              ],
            },
            {
              label: 'Publisher',
              values: [{ label: data.publisher ?? unavailable }],
            },
          ]
        : [
            {
              label: 'Creator',
              values:
                data.createdBy.length > 0
                  ? data.createdBy.slice(0, 2).map((person) => ({
                      label: person.name,
                      href: `/person/${person.id}`,
                    }))
                  : [{ label: unavailable }],
            },
            {
              label: 'Network',
              values:
                data.networks.length > 0
                  ? data.networks.slice(0, 2).map((network) => ({
                      label: network.name,
                      href: `/discover/tv/network/${network.id}`,
                    }))
                  : [{ label: unavailable }],
            },
          ];
  const genres: LinkedValue[] = isMusic
    ? (data.tags?.releaseGroup ?? []).slice(0, 3).map((genre) => ({
        label: genre.tag,
      }))
    : isBook
      ? (data.subjects ?? []).slice(0, 3).map((subject) => ({
          label: subject,
        }))
      : data.genres.slice(0, 3).map((genre) => ({
          label: genre.name,
          href:
            mediaType === 'movie'
              ? `/discover/movies/genre/${genre.id}`
              : `/discover/tv/genre/${genre.id}`,
        }));
  const bookWorkId = isBook
    ? normalizeOpenLibraryWorkId(data.id?.toString() ?? '')
    : undefined;
  const resolvedHref =
    mediaHref ??
    (mediaType === 'movie'
      ? `/movie/${data.id}`
      : mediaType === 'tv'
        ? `/tv/${data.id}`
        : mediaType === 'music' && isMusic
          ? `/music/${encodeApiPathSegment(data.id)}`
          : bookWorkId
            ? `/book/${encodeApiPathSegment(bookWorkId)}`
            : undefined);

  return (
    <article className="refreshed-card-surface relative rounded-xl border border-gray-700 p-3 text-gray-400 shadow-lg shadow-gray-950/20">
      {artworkSrc && (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl"
          aria-hidden
        >
          <CachedImage
            type={artworkType}
            src={artworkSrc}
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 48rem, 100vw"
            className="object-cover object-top"
          />
          <div className="refreshed-artwork-scrim" />
          <div className="refreshed-artwork-gradient" />
        </div>
      )}
      <div className="relative z-10">
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type={posterType}
              src={posterSrc}
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            {resolvedHref ? (
              <Link
                href={resolvedHref}
                className="-mt-0.5 block truncate text-lg font-semibold leading-5 text-white hover:underline"
              >
                {title}
                {releaseYear ? ` (${releaseYear})` : ''}
              </Link>
            ) : (
              <h3 className="-mt-0.5 truncate text-lg font-semibold leading-5 text-white">
                {title}
                {releaseYear ? ` (${releaseYear})` : ''}
              </h3>
            )}

            <div className="mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch card:grid-cols-3">
              <div className="min-w-0 card:col-span-2 card:pr-3">
                <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4 card:grid-cols-[max-content_0.75rem_6rem_0.75rem_1px_0.75rem_minmax(0,1fr)] card:gap-x-0">
                  <dt className="font-medium text-gray-100 card:col-start-1 card:row-start-1">
                    Media &amp; Format:
                  </dt>
                  <dd className="m-0 truncate card:col-start-3 card:row-start-1">
                    {mediaLabel}
                  </dd>
                  <dt className="font-medium text-gray-100 card:col-start-1 card:row-start-2">
                    {isBook ? 'First Published' : 'Release Date'}:
                  </dt>
                  <dd className="m-0 truncate card:col-start-3 card:row-start-2">
                    {releaseDate || unavailable}
                  </dd>
                  <dt className="font-medium text-gray-100 card:col-start-1 card:row-start-3">
                    {isBook ? 'Pages' : 'Runtime'}:
                  </dt>
                  <dd className="m-0 truncate card:col-start-3 card:row-start-3">
                    {runtime}
                  </dd>

                  <div className="hidden bg-gray-600 card:col-start-5 card:row-span-3 card:row-start-1 card:block" />
                  <div className="col-span-2 mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 card:col-span-1 card:col-start-7 card:row-span-3 card:row-start-1 card:mt-0 card:border-t-0 card:pt-0">
                    {secondaryRows.slice(0, 3).map((row) => (
                      <div className="contents" key={row.label}>
                        <dt className="font-medium text-gray-100">
                          {row.label}:
                        </dt>
                        <dd className="m-0 truncate">
                          {linkedValues(row.values)}
                        </dd>
                      </div>
                    ))}
                  </div>

                  <dt className="mt-0.5 font-medium text-gray-100 card:col-start-1 card:row-start-4">
                    Genres:
                  </dt>
                  <dd className="m-0 mt-0.5 line-clamp-2 min-w-0 break-words card:col-span-5 card:col-start-3 card:row-start-4">
                    {genres.length > 0 ? linkedValues(genres) : unavailable}
                  </dd>
                </dl>
              </div>

              <dl className="mt-2 grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 card:relative card:mt-0 card:border-t-0 card:pl-3 card:pt-0 card:before:absolute card:before:bottom-1 card:before:left-0 card:before:top-0 card:before:w-px card:before:bg-gray-600">
                {rightDetails.map((detail, index) => (
                  <div className="contents" key={`${detail.label}-${index}`}>
                    <dt
                      className="font-medium text-gray-100"
                      aria-hidden={!detail.label}
                    >
                      {detail.label ? `${detail.label}:` : ''}
                    </dt>
                    <dd className="m-0 truncate">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
        {footer && (
          <div className="mt-[5px] flex flex-wrap gap-2">{footer}</div>
        )}
      </div>
    </article>
  );
};

export default IssueMediaSummary;
