import BookFormatBadge, {
  getBookFormatMessage,
  getRequestedBookFormat,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaTypeBadge, {
  type MediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import useRequestStatusScrollRestoration from '@app/hooks/useRequestStatusScrollRestoration';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { Transition } from '@headlessui/react';
import {
  ArchiveBoxXMarkIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  ServerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
  RequestStatusUsersResponse,
} from '@server/interfaces/api/requestInterfaces';
import type { RequestStatusSortField } from '@server/lib/requestStatusSort';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { useSWRConfig } from 'swr';
import {
  canLoadRequestStatus,
  type RequestStatusUserSelection,
} from './requestStatusQuery';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.RequestStatus', {
  title: 'Request Status',
  manageRequests: 'Manage Requests',
  selectUser: 'Select User to View Requests',
  userFilter: 'Select User',
  allUsers: 'All Users',
  taskFilters: 'Task Filters',
  all: 'All Requests',
  active: 'Active',
  attention: 'Needs Attention',
  completed: 'Completed',
  pending: 'Pending',
  processing: 'Active',
  deleted: 'Deleted',
  requested: 'Requested',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Importing',
  library: 'Adding to library',
  available: 'Available',
  unavailable: 'Unavailable',
  noReleaseFoundFilter: 'No Release Found',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  mediaType: 'Media Type',
  mediaTypeValue: 'Media Type',
  movie: 'Movie',
  series: 'Series',
  album: 'Album',
  bookAndAudiobook: 'Book + Audiobook',
  book: 'Book',
  fourK: '4K',
  hd: 'HD',
  musicFormat: 'Music',
  ebookAndAudiobook: 'Ebook + Audiobook',
  ebook: 'Ebook',
  minutes: '{count} minutes',
  notAvailable: 'Not available',
  releaseDate: 'Release Date',
  firstPublished: 'First Published',
  runtime: 'Runtime',
  pages: 'Pages',
  genres: 'Genres',
  author: 'Author',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  director: 'Director',
  writer: 'Writer',
  creator: 'Creator',
  publisher: 'Publisher',
  network: 'Network',
  studio: 'Studio',
  requestDate: 'Date',
  requestTime: 'Time',
  statusUpdated: 'Status Updated',
  timeFrame: 'Time Period',
  last7Days: 'Last 7 days',
  last14Days: 'Last 14 days',
  last30Days: 'Last 30 days',
  last6Months: 'Last 6 months',
  allTime: 'All time',
  olderRequests:
    '{count, plural, =1 {# older request is outside this window.} other {# older requests are outside this window.}}',
  viewAllHistory: 'View All History',
  filter: 'Filters',
  statusFilter: 'Request Type',
  allMedia: 'All Media',
  movies: 'Movies',
  music: 'Music',
  ebooks: 'Ebooks',
  audiobooks: 'Audiobooks',
  mediaAndFormat: 'Media & format',
  showingFormat: 'Showing requests for',
  format: 'Format',
  sortBy: 'Sort By',
  sortAdded: 'Date',
  sortTitle: 'Title',
  sortStatus: 'Status',
  sortDirector: 'Director',
  sortWriter: 'Writer',
  sortRating: 'Rating',
  sortReleaseDate: 'Release Date',
  sortFirstPublished: 'First Published',
  sortArtist: 'Artist',
  sortAuthor: 'Author',
  sortPublisher: 'Publisher',
  sortAscending: 'Ascending',
  sortDescending: 'Descending',
  progressUnavailable: 'Download service did not provide progress data.',
  progressFrom: '{percent}% complete',
  sizeProgress: '{complete} of {total}',
  eta: 'ETA: {date}',
  history: 'History',
  hideHistory: 'Hide History',
  noHistory: 'No status history has been recorded yet.',
  requestedBy: 'Requested by {user}',
  requestedByLabel: 'Requested By',
  requestedAt: 'Requested {date}',
  requestedDateTime: 'Requested On',
  service: 'Service: {service}',
  serviceLabel: 'Service',
  retry: 'Retry',
  retrying: 'Retrying…',
  retryTooltip: 'Restart this failed request from approval.',
  approve: 'Approve',
  approveTooltip: 'Approve this pending request.',
  decline: 'Decline',
  declineTooltip: 'Decline this pending request.',
  edit: 'Edit',
  editTooltip: 'Edit this pending request.',
  modifyFailed: 'Unable to update this request.',
  retryFailed: 'Unable to retry this request.',
  retrySuccess: 'Request queued for another attempt.',
  delete: 'Delete',
  deleting: 'Deleting…',
  deleteTooltip: 'Delete this request and its status history.',
  deleteTitle: 'Delete request status entry?',
  deleteDescription:
    'Seerr will cancel any active work it can identify, clean up temporary request records, and permanently remove this entry and its history.',
  deleteFailed: 'Unable to delete this request entry.',
  deleteSuccess: 'Request entry deleted.',
  remove: 'Delete From Library',
  removing: 'Deleting…',
  removeTooltip: 'The media and the library entry will both be deleted.',
  removeUnavailableTooltip: 'No linked library item is available to delete.',
  removeTitle: 'Delete item from {service}?',
  removeDescription:
    'Delete {title} and its media files from {service}. Seerr will preserve an author or artist that still has other books or albums.',
  removeFailed: 'Unable to delete this item from its library service.',
  removeSuccess: 'Item deleted from its library service.',
  adminView: 'Admin View',
  userView: 'User View',
  viewMode: 'Request Status view mode',
  loading: 'Loading request status',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  loadError: 'Request status could not be loaded.',
  loadErrorHint: 'The request service did not respond. Try again.',
  retryLoad: 'Try Again',
  noResults: 'No requests match these filters.',
  clearFilters: 'Clear Filters',
  previous: 'Previous',
  next: 'Next',
  page: 'Page {page} of {pages}',
  scrollProgressLeft: 'Scroll progress left',
  requestLifecycle: 'Request lifecycle',
  scrollProgressRight: 'Scroll progress right',
  pagination: 'Pagination',
  unknownTitle: 'Unknown title',
});

type MediaDetails = MovieDetails | TvDetails | MusicDetails | BookDetails;
type StatusStage =
  | 'requested'
  | 'approved'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'library'
  | 'available'
  | 'unavailable'
  | 'failed'
  | 'declined'
  | 'cancelled';
type RequestStatusItem = RequestStatusResultsResponse['results'][number];
type MediaFilter = 'all' | 'movie' | 'tv' | 'music' | 'book' | 'audiobook';
type UserSelection = Exclude<RequestStatusUserSelection, null>;
type TimeFrame = '7d' | '14d' | '30d' | '6m' | 'all';
type ViewMode = 'admin' | 'user';

type RemoveSelection = {
  requestId: number;
  mediaId: number;
  title: string;
  service: string;
  is4k: boolean;
  format?: RequestedBookFormat;
};

const timelineStages: StatusStage[] = [
  'requested',
  'approved',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
];
const statusStageValues: string[] = [
  ...timelineStages,
  'unavailable',
  'failed',
  'declined',
  'cancelled',
];

const requestTypeFilterValues = [
  'all',
  'pending',
  'completed',
  'processing',
  'attention',
  'available',
  'unavailable',
  'failed',
];
const mediaTypeValues: MediaFilter[] = [
  'all',
  'movie',
  'tv',
  'music',
  'book',
  'audiobook',
];

const statusMediaBadgeTone: Record<MediaTypeBadgeType, string> = {
  movie: 'border-blue-500/70 bg-blue-700/70 text-blue-50',
  tv: 'border-violet-300/90 bg-purple-700/70 text-purple-50',
  collection: 'border-blue-500/70 bg-blue-700/70 text-blue-50',
  album: 'border-emerald-500/70 bg-emerald-700/70 text-emerald-50',
  artist: 'border-fuchsia-500/70 bg-fuchsia-700/70 text-fuchsia-50',
  book: 'border-amber-500/70 bg-amber-700/70 text-amber-50',
};

const sortDirectionValues = ['asc', 'desc'] as const;
const timeFrameValues: TimeFrame[] = ['7d', '14d', '30d', '6m', 'all'];

const getSortOptions = (
  mediaFilter: MediaFilter
): { value: RequestStatusSortField; label: keyof typeof messages }[] => {
  const common: {
    value: RequestStatusSortField;
    label: keyof typeof messages;
  }[] = [
    { value: 'added', label: 'sortAdded' },
    { value: 'title', label: 'sortTitle' },
    { value: 'status', label: 'sortStatus' },
  ];

  switch (mediaFilter) {
    case 'movie':
      return [
        ...common,
        { value: 'director', label: 'sortDirector' },
        { value: 'rating', label: 'sortRating' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'tv':
      return [
        ...common,
        { value: 'writer', label: 'sortWriter' },
        { value: 'director', label: 'sortDirector' },
        { value: 'rating', label: 'sortRating' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'music':
      return [
        ...common,
        { value: 'artist', label: 'sortArtist' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'book':
    case 'audiobook':
      return [
        ...common,
        { value: 'author', label: 'sortAuthor' },
        { value: 'publisher', label: 'sortPublisher' },
        { value: 'releaseDate', label: 'sortFirstPublished' },
      ];
    default:
      return common;
  }
};

const getDefaultSortDirection = (
  field: RequestStatusSortField
): 'asc' | 'desc' =>
  ['title', 'director', 'writer', 'artist', 'author', 'publisher'].includes(
    field
  )
    ? 'asc'
    : 'desc';

const getSafeQueryValue = (
  value: string | string[] | undefined,
  allowedValues: readonly string[]
): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && allowedValues.includes(candidate) ? candidate : 'all';
};

const getTimeFrameFromQuery = (
  value: string | string[] | undefined
): TimeFrame => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === '1m') {
    return '30d';
  }
  return candidate && timeFrameValues.includes(candidate as TimeFrame)
    ? (candidate as TimeFrame)
    : '7d';
};

const fetchStatusUsers = async (
  url: string
): Promise<RequestStatusUsersResponse> => {
  const firstResponse = await axios.get<RequestStatusUsersResponse>(url);
  const firstPage = firstResponse.data;
  const pageSize = firstPage.pageInfo.pageSize || 100;
  const remainingPages = Math.max(firstPage.pageInfo.pages - 1, 0);
  if (remainingPages === 0) {
    return firstPage;
  }

  const pages = await Promise.all(
    Array.from({ length: remainingPages }, (_, index) => {
      const pageUrl = new URL(url, 'http://seerrng.local');
      pageUrl.searchParams.set('skip', String((index + 1) * pageSize));
      return axios.get<RequestStatusUsersResponse>(
        `${pageUrl.pathname}${pageUrl.search}`
      );
    })
  );

  return {
    ...firstPage,
    results: [
      ...firstPage.results,
      ...pages.flatMap((response) => response.data.results),
    ],
  };
};

const stageMessageKeys: Record<StatusStage, keyof typeof messages> = {
  requested: 'requested',
  approved: 'approved',
  searching: 'searching',
  downloading: 'downloading',
  importing: 'importing',
  library: 'library',
  available: 'available',
  unavailable: 'unavailable',
  failed: 'failed',
  declined: 'declined',
  cancelled: 'cancelled',
};

const stageTone: Record<StatusStage, string> = {
  requested: 'border-gray-500 bg-gray-700/70 text-gray-100',
  approved: 'border-indigo-400 bg-indigo-500/20 text-indigo-100',
  searching: 'border-violet-400 bg-violet-500/20 text-violet-100',
  downloading: 'border-blue-400 bg-blue-500/20 text-blue-100',
  importing: 'border-cyan-400 bg-cyan-500/20 text-cyan-100',
  library: 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100',
  available: 'border-emerald-400 bg-emerald-500/20 text-emerald-100',
  unavailable: 'border-amber-400 bg-amber-500/20 text-amber-100',
  failed: 'border-red-400 bg-red-500/20 text-red-100',
  declined: 'border-red-400 bg-red-500/20 text-red-100',
  cancelled: 'border-gray-500 bg-gray-700/70 text-gray-200',
};

const stageIcon: Record<StatusStage, typeof InformationCircleIcon> = {
  requested: ClockIcon,
  approved: CheckIcon,
  searching: MagnifyingGlassIcon,
  downloading: ArrowDownTrayIcon,
  importing: ArrowPathIcon,
  library: ServerIcon,
  available: CheckIcon,
  unavailable: InformationCircleIcon,
  failed: ExclamationTriangleIcon,
  declined: ExclamationTriangleIcon,
  cancelled: InformationCircleIcon,
};

const isMusic = (details: MediaDetails): details is MusicDetails =>
  (details as MusicDetails).artist !== undefined;

const isBook = (details: MediaDetails): details is BookDetails =>
  (details as BookDetails).mediaType === 'book';

const getBookId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;

const getDetailsUrl = (item: RequestStatusItem): string | null => {
  const request = item.request;
  if (request.type === 'movie' || request.type === 'tv') {
    return `/api/v1/${request.type}/${request.media.tmdbId}`;
  }
  if (request.type === 'music' && request.media.mbId) {
    return `/api/v1/music/${encodeApiPathSegment(normalizeMusicBrainzId(request.media.mbId))}`;
  }
  const bookId = getBookId(item);
  return bookId
    ? `/api/v1/book/${encodeApiPathSegment(normalizeOpenLibraryWorkId(bookId))}`
    : null;
};

const getDetailHref = (item: RequestStatusItem): string | null => {
  const request = item.request;
  if (request.type === 'movie' || request.type === 'tv') {
    return `/${request.type}/${request.media.tmdbId}`;
  }
  if (request.type === 'music' && request.media.mbId) {
    return `/music/${encodeApiPathSegment(normalizeMusicBrainzId(request.media.mbId))}`;
  }
  const bookId = getBookId(item);
  const bookFormat = getRequestedBookFormat(item.request.bookFormat);
  return bookId
    ? `/book/${encodeApiPathSegment(normalizeOpenLibraryWorkId(bookId))}?format=${bookFormat}`
    : null;
};

const getTitle = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (details) {
    if (isMusic(details) || isBook(details)) {
      return details.title;
    }
    return 'title' in details ? details.title : details.name;
  }
  if (item.request.type === 'music' && item.request.media.mbId) {
    return item.request.media.mbId;
  }
  if (item.request.type === 'book') {
    return getBookId(item) ?? intl.formatMessage(messages.unknownTitle);
  }
  return `${item.request.type.toUpperCase()} #${item.request.media.tmdbId}`;
};

const getPoster = (
  details: MediaDetails | undefined
): { src: string; type: 'tmdb' | 'music' | 'book' } => {
  if (!details?.posterPath) {
    return { src: '/images/seerr_poster_not_found.png', type: 'tmdb' };
  }
  if (isMusic(details)) {
    return { src: details.posterPath, type: 'music' };
  }
  if (isBook(details)) {
    return { src: details.posterPath, type: 'book' };
  }
  return { src: getTmdbPosterImageUrl(details.posterPath), type: 'tmdb' };
};

const getMediaBadge = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string => {
  if (item.request.type === 'movie') return intl.formatMessage(messages.movie);
  if (item.request.type === 'tv') return intl.formatMessage(messages.series);
  if (item.request.type === 'music') return intl.formatMessage(messages.album);
  return intl.formatMessage(messages.book);
};

const getMediaBadgeType = (
  item: RequestStatusItem
): MediaTypeBadgeType | undefined => {
  if (item.request.type === 'movie') return 'movie';
  if (item.request.type === 'tv') return 'tv';
  if (item.request.type === 'music') return 'album';
  return undefined;
};

const getMediaFormat = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string => {
  if (item.request.type === 'movie' || item.request.type === 'tv') {
    return intl.formatMessage(item.request.is4k ? messages.fourK : messages.hd);
  }
  if (item.request.type === 'music') {
    return intl.formatMessage(messages.musicFormat);
  }
  return intl.formatMessage(
    getBookFormatMessage(getRequestedBookFormat(item.request.bookFormat))
  );
};

const getReleaseDate = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string | undefined => {
  if (!details) return undefined;
  if (item.request.type === 'movie') {
    return (details as MovieDetails).releaseDate;
  }
  if (item.request.type === 'tv') {
    return (details as TvDetails).firstAirDate;
  }
  if (item.request.type === 'music') {
    return (details as MusicDetails).releaseDate;
  }
  const year = (details as BookDetails).firstPublishYear;
  return year ? String(year) : undefined;
};

const getReleaseDateLabel = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string =>
  intl.formatMessage(
    item.request.type === 'book'
      ? messages.firstPublished
      : messages.releaseDate
  );

const getRuntime = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  const notAvailable = intl.formatMessage(messages.notAvailable);
  if (!details) return notAvailable;
  if (item.request.type === 'movie') {
    const minutes = (details as MovieDetails).runtime;
    return minutes && Number.isFinite(minutes)
      ? intl.formatMessage(messages.minutes, { count: minutes })
      : notAvailable;
  }
  if (item.request.type === 'tv') {
    const minutes = (details as TvDetails).episodeRunTime.find(
      (runtime) => runtime > 0 && Number.isFinite(runtime)
    );
    return minutes
      ? intl.formatMessage(messages.minutes, { count: minutes })
      : notAvailable;
  }
  if (item.request.type === 'music') {
    const milliseconds = (details as MusicDetails).tracks.reduce(
      (total, track) => total + Math.max(track.length, 0),
      0
    );
    return milliseconds > 0
      ? intl.formatMessage(messages.minutes, {
          count: Math.round(milliseconds / 60000),
        })
      : notAvailable;
  }
  return notAvailable;
};

const getRuntimeLabel = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string =>
  intl.formatMessage(
    item.request.type === 'book' ? messages.pages : messages.runtime
  );

const getRuntimeOrPages = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (item.request.type !== 'book') {
    return getRuntime(intl, details, item);
  }

  const pages = details ? (details as BookDetails).numberOfPages : undefined;
  return pages && Number.isFinite(pages)
    ? intl.formatNumber(pages)
    : intl.formatMessage(messages.notAvailable);
};

type FeaturedCredit = {
  label: string;
  name: string;
  href?: string;
};

const getFeaturedCredits = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): FeaturedCredit[] => {
  const notAvailable = intl.formatMessage(messages.notAvailable);

  if (!details) {
    if (item.request.type === 'book' || item.request.type === 'music') {
      return [
        {
          label: intl.formatMessage(
            item.request.type === 'book' ? messages.author : messages.artist
          ),
          name: notAvailable,
        },
      ];
    }

    return [
      {
        label: intl.formatMessage(
          item.request.type === 'tv' ? messages.creator : messages.director
        ),
        name: notAvailable,
      },
      {
        label: intl.formatMessage(messages.writer),
        name: notAvailable,
      },
    ];
  }

  if (item.request.type === 'book') {
    const book = details as BookDetails;
    return [
      {
        label: intl.formatMessage(messages.author),
        name: book.author || notAvailable,
        href: book.authorId
          ? `/author/${encodeApiPathSegment(book.authorId)}`
          : undefined,
      },
    ];
  }

  if (item.request.type === 'music') {
    const music = details as MusicDetails;
    return [
      {
        label: intl.formatMessage(messages.artist),
        name: music.artist?.name || notAvailable,
        href: music.artist?.id
          ? `/artist/${encodeApiPathSegment(music.artist.id)}`
          : undefined,
      },
    ];
  }

  const mediaDetails = details as MovieDetails | TvDetails;
  const sortedCrew = sortCrewPriority(mediaDetails.credits?.crew ?? []);
  const featuredCrew =
    item.request.type === 'tv' && (details as TvDetails).createdBy.length > 0
      ? [
          ...(details as TvDetails).createdBy.map((person) => ({
            id: person.id,
            job: intl.formatMessage(messages.creator),
            name: person.name,
          })),
          ...sortedCrew,
        ]
      : sortedCrew;

  return featuredCrew.slice(0, 2).map((person) => ({
    label: person.job,
    name: person.name,
    href: `/person/${person.id}`,
  }));
};

const getSecondaryDetails = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): FeaturedCredit[] => {
  const notAvailable = intl.formatMessage(messages.notAvailable);

  if (item.request.type === 'book') {
    return [
      {
        label: intl.formatMessage(messages.publisher),
        name: (details as BookDetails | undefined)?.publisher ?? notAvailable,
      },
    ];
  }

  if (item.request.type === 'music') {
    const music = details as MusicDetails | undefined;
    return [
      {
        label: intl.formatMessage(messages.albumType),
        name: music?.type || notAvailable,
      },
      {
        label: intl.formatMessage(messages.trackCount),
        name: music ? intl.formatNumber(music.tracks.length) : notAvailable,
      },
    ];
  }

  if (item.request.type === 'tv') {
    const tv = details as TvDetails | undefined;
    const network = tv?.networks?.[0];
    return [
      {
        label: intl.formatMessage(messages.network),
        name:
          network?.name ?? tv?.productionCompanies?.[0]?.name ?? notAvailable,
        href: network?.id ? `/discover/tv/network/${network.id}` : undefined,
      },
    ];
  }

  const studio = (details as MovieDetails | undefined)
    ?.productionCompanies?.[0];
  return [
    {
      label: intl.formatMessage(messages.studio),
      name: studio?.name ?? notAvailable,
      href: studio?.id ? `/discover/movies/studio/${studio.id}` : undefined,
    },
  ];
};

type GenreLink = {
  name: string;
  href: string;
};

const getGenres = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): GenreLink[] => {
  if (!details) return [];
  if (item.request.type === 'movie') {
    return (details as MovieDetails).genres.slice(0, 3).map((genre) => ({
      name: genre.name,
      href: `/discover/movies/genre/${genre.id}`,
    }));
  }
  if (item.request.type === 'tv') {
    return (details as TvDetails).genres.slice(0, 3).map((genre) => ({
      name: genre.name,
      href: `/discover/tv/genre/${genre.id}`,
    }));
  }
  if (item.request.type === 'music') {
    return (
      (details as MusicDetails).tags?.releaseGroup
        .map((tag) => tag.tag.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((name) => ({
          name,
          href: `/discover/music?genre=${encodeURIComponent(name)}`,
        })) ?? []
    );
  }
  return (
    (details as BookDetails).subjects
      ?.map((subject) => subject.trim())
      .filter(
        (subject) =>
          !!subject &&
          !/^(?:collection|work|edition|record)id\s*:/i.test(subject)
      )
      .slice(0, 3)
      .map((name) => ({
        name,
        href: `/discover/books?subject=${encodeURIComponent(name)}`,
      })) ?? []
  );
};

const formatBytes = (
  intl: ReturnType<typeof useIntl>,
  value: number | null
): string => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return intl.formatMessage(messages.notAvailable);
  }
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
};

const getStageLabel = (intl: ReturnType<typeof useIntl>, stage: StatusStage) =>
  intl.formatMessage(messages[stageMessageKeys[stage]]);

const getValidDate = (
  value: string | number | Date | null | undefined
): Date | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
};

const getLastTimelineIndex = (
  stage: StatusStage,
  history: RequestStatusDetailResponse['history']['results']
): number => {
  const directIndex = timelineStages.indexOf(stage);
  if (directIndex >= 0) return directIndex;
  for (const event of history) {
    const eventIndex = timelineStages.indexOf(event.stage);
    if (eventIndex >= 0) return eventIndex;
  }
  return 0;
};

interface RequestStatusCardProps {
  item: RequestStatusItem;
  isAdminView: boolean;
  onRetry: (requestId: number) => Promise<void>;
  isRetrying: boolean;
  onDelete: (requestId: number) => void;
  isDeleting: boolean;
  onRemove: (requestId: number, title: string, service: string) => void;
  isRemoving: boolean;
  isHistoryOpen: boolean;
  onToggleHistory: (requestId: number) => void;
}

const RequestStatusCard = ({
  item,
  isAdminView,
  onRetry,
  isRetrying,
  onDelete,
  isDeleting,
  onRemove,
  isRemoving,
  isHistoryOpen,
  onToggleHistory,
}: RequestStatusCardProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission, user } = useUser();
  const { mutate: mutateCache } = useSWRConfig();
  const [showEditModal, setShowEditModal] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const detailsUrl = getDetailsUrl(item);
  const detailHref = getDetailHref(item);
  const { data: details } = useSWR<MediaDetails>(detailsUrl);
  const { data: detail, mutate: revalidateDetail } =
    useSWR<RequestStatusDetailResponse>(
      `/api/v1/request/status/${item.request.id}`,
      {
        refreshInterval: 15000,
        revalidateOnFocus: true,
      }
    );
  const reportedCurrent = detail?.current ?? item.status;
  const observedCurrent =
    item.request.rootFolder === '__preview_downloading__'
      ? {
          ...reportedCurrent,
          stage: 'downloading' as const,
          percent: 63.4,
          size: 21_474_836_480,
          sizeLeft: 7_859_790_152,
          estimatedCompletionTime: null,
          downloadCount: 1,
          downloadId: null,
          service: 'Radarr-HD',
          message: 'A usable release is downloading.',
          isTerminal: false,
          needsAttention: false,
          retryable: false,
        }
      : reportedCurrent;
  const current = isRetrying
    ? {
        ...observedCurrent,
        stage: 'approved' as const,
        percent: null,
        size: null,
        sizeLeft: null,
        estimatedCompletionTime: null,
        downloadCount: 0,
        downloadId: null,
        message: 'Approved for processing.',
        observedAt: new Date(),
        isTerminal: false,
        needsAttention: false,
        retryable: false,
      }
    : observedCurrent;
  const history = detail?.history.results ?? [];
  const currentStage = statusStageValues.includes(current.stage)
    ? (current.stage as StatusStage)
    : 'approved';
  const activeIndex = getLastTimelineIndex(currentStage, history);
  const poster = getPoster(details);
  const title = getTitle(intl, details, item);
  const mediaBadgeType = getMediaBadgeType(item) ?? 'movie';
  const StageIcon = stageIcon[currentStage] ?? InformationCircleIcon;
  const releaseDate = getReleaseDate(details, item);
  const releaseYear = releaseDate?.match(/\d{4}/)?.[0];
  const displayTitle = releaseYear ? `${title} (${releaseYear})` : title;
  const displayReleaseDate = releaseDate
    ? /^\d{4}$/.test(releaseDate)
      ? releaseDate
      : (() => {
          const parsedReleaseDate = getValidDate(releaseDate);
          return parsedReleaseDate
            ? intl.formatDate(parsedReleaseDate, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : intl.formatMessage(messages.notAvailable);
        })()
    : intl.formatMessage(messages.notAvailable);
  const bookFormat: RequestedBookFormat | undefined =
    item.request.type === 'book'
      ? getRequestedBookFormat(item.request.bookFormat)
      : undefined;
  const terminalWithoutProgress =
    current.isTerminal && currentStage !== 'available';
  const chronologicalHistory = [...history].reverse();
  const estimatedCompletionTime = getValidDate(current.estimatedCompletionTime);
  const createdAt = getValidDate(item.request.createdAt);
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const featuredCredits = getFeaturedCredits(intl, details, item);
  const secondaryDetails = getSecondaryDetails(intl, details, item);
  const genres = getGenres(details, item);
  const canShowDelete =
    isAdminView && hasPermission(Permission.MANAGE_REQUESTS);
  const canRetry =
    (observedCurrent.stage === 'failed' ||
      observedCurrent.stage === 'unavailable') &&
    ((isAdminView && hasPermission(Permission.MANAGE_REQUESTS)) ||
      item.request.requestedBy.id === user?.id);
  const canShowRemove =
    isAdminView && hasPermission(Permission.MANAGE_REQUESTS);
  const canRemove = canShowRemove && item.canRemove === true;
  const canModeratePending =
    isAdminView &&
    hasPermission(Permission.MANAGE_REQUESTS) &&
    item.request.status === MediaRequestStatus.PENDING;
  const posterBadgeClassName =
    'h-[18px] w-full justify-center gap-0.5 px-1 py-0 text-[9px] shadow-sm backdrop-blur-[1px] [&_svg]:h-2.5 [&_svg]:w-2.5';
  const posterBadge = bookFormat ? (
    <BookFormatBadge
      format={bookFormat}
      variant="compact"
      className={`bg-amber-700/70 text-amber-50 ${posterBadgeClassName}`}
    />
  ) : (
    <MediaTypeBadge
      mediaType={mediaBadgeType}
      variant="compact"
      className={`${statusMediaBadgeTone[mediaBadgeType]} ${posterBadgeClassName}`}
    />
  );
  const refreshRequestStatus = async () => {
    await Promise.all([
      revalidateDetail(),
      mutateCache(
        (key) =>
          typeof key === 'string' && key.startsWith('/api/v1/request/status')
      ),
      mutateCache('/api/v1/request/count'),
    ]);
  };
  const modifyPendingRequest = async (action: 'approve' | 'decline') => {
    setIsModifying(true);
    try {
      await axios.post(`/api/v1/request/${item.request.id}/${action}`);
      await refreshRequestStatus();
    } catch {
      addToast(intl.formatMessage(messages.modifyFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsModifying(false);
    }
  };
  const scrollTimeline = (direction: -1 | 1) => {
    timelineRef.current?.scrollBy({
      left: direction * 260,
      behavior: 'smooth',
    });
  };
  const actionControls = (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {canModeratePending && (
        <>
          <Tooltip content={intl.formatMessage(messages.approveTooltip)}>
            <button
              type="button"
              className="inline-flex h-[22px] items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] font-semibold leading-none text-emerald-200 transition hover:border-emerald-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('approve')}
            >
              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.approve)}
            </button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.declineTooltip)}>
            <button
              type="button"
              className="inline-flex h-[22px] items-center gap-1 rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] font-semibold leading-none text-red-200 transition hover:border-red-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('decline')}
            >
              <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.decline)}
            </button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.editTooltip)}>
            <button
              type="button"
              className="inline-flex h-[22px] items-center gap-1 rounded-md border border-amber-600/80 bg-amber-800/25 px-2 text-[11px] font-semibold leading-none text-amber-200 transition hover:border-amber-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40"
              disabled={isModifying}
              onClick={() => setShowEditModal(true)}
            >
              <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.edit)}
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip content={intl.formatMessage(messages.retryTooltip)}>
        <button
          type="button"
          className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border border-amber-600/80 bg-amber-800/25 px-2 text-[11px] font-semibold leading-none text-amber-300 transition hover:border-amber-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canRetry || isRetrying || isDeleting || isRemoving}
          onClick={() => void onRetry(item.request.id)}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {intl.formatMessage(isRetrying ? messages.retrying : messages.retry)}
        </button>
      </Tooltip>
      {canShowDelete && (
        <Tooltip content={intl.formatMessage(messages.deleteTooltip)}>
          <button
            type="button"
            className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] font-semibold leading-none text-red-200 transition hover:border-red-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isDeleting || isRetrying || isRemoving}
            onClick={() => onDelete(item.request.id)}
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isDeleting ? messages.deleting : messages.delete
            )}
          </button>
        </Tooltip>
      )}
      {canShowRemove && (
        <Tooltip
          content={intl.formatMessage(
            canRemove
              ? messages.removeTooltip
              : messages.removeUnavailableTooltip
          )}
        >
          <button
            type="button"
            className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border border-rose-400 bg-rose-500/25 px-2 text-[11px] font-semibold leading-none text-rose-100 transition hover:border-rose-200 hover:bg-rose-500/45 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canRemove || isRemoving || isRetrying || isDeleting}
            onClick={() =>
              onRemove(
                item.request.id,
                displayTitle,
                current.service ?? 'library service'
              )
            }
          >
            <ArchiveBoxXMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isRemoving ? messages.removing : messages.remove
            )}
          </button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      {showEditModal && (
        <RequestModal
          show
          tmdbId={
            item.request.type === 'music' || item.request.type === 'book'
              ? undefined
              : item.request.media.tmdbId
          }
          mbId={
            item.request.type === 'music'
              ? (item.request.media.mbId ?? undefined)
              : undefined
          }
          bookId={item.request.type === 'book' ? getBookId(item) : undefined}
          type={item.request.type}
          is4k={item.request.is4k}
          editRequest={item.request}
          onCancel={() => setShowEditModal(false)}
          onComplete={() => {
            setShowEditModal(false);
            void refreshRequestStatus();
          }}
        />
      )}
      <article
        className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/95 p-3 shadow-lg shadow-gray-950/20"
        data-testid={`request-status-${item.request.id}`}
      >
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="min-w-0 self-start">
            {detailHref ? (
              <Link
                href={detailHref}
                aria-label={displayTitle}
                className="relative block h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 transition duration-200 hover:ring-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 motion-reduce:transition-none sm:h-[120px] sm:w-20"
              >
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
                <span className="pointer-events-none absolute left-1/2 top-1 z-10 w-[calc(100%-0.375rem)] -translate-x-1/2">
                  {posterBadge}
                </span>
              </Link>
            ) : (
              <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
                <span className="pointer-events-none absolute left-1/2 top-1 z-10 w-[calc(100%-0.375rem)] -translate-x-1/2">
                  {posterBadge}
                </span>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            {detailHref ? (
              <Link
                href={detailHref}
                className="-mt-0.5 block truncate text-lg font-semibold leading-5 text-white hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {displayTitle}
              </Link>
            ) : (
              <h3 className="-mt-0.5 truncate text-lg font-semibold leading-5 text-white">
                {displayTitle}
              </h3>
            )}

            <div className="mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch md:grid-cols-3">
              <div className="min-w-0 md:col-span-2 md:pr-3">
                <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-2 gap-y-0.5 text-xs leading-4 text-gray-400 md:grid-cols-[max-content_0.5rem_max-content_0.75rem_1px_0.75rem_minmax(0,1fr)] md:gap-x-0">
                  <dt className="font-medium text-gray-100 md:col-start-1 md:row-start-1">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="m-0 truncate md:col-start-3 md:row-start-1">
                    {getMediaBadge(intl, item)} · {getMediaFormat(intl, item)}
                  </dd>
                  <dt className="font-medium text-gray-100 md:col-start-1 md:row-start-2">
                    {getReleaseDateLabel(intl, item)}:
                  </dt>
                  <dd className="m-0 truncate md:col-start-3 md:row-start-2">
                    {displayReleaseDate}
                  </dd>
                  <dt className="font-medium text-gray-100 md:col-start-1 md:row-start-3">
                    {getRuntimeLabel(intl, item)}:
                  </dt>
                  <dd className="m-0 truncate md:col-start-3 md:row-start-3">
                    {getRuntimeOrPages(intl, details, item)}
                  </dd>

                  <div className="hidden bg-gray-600 md:col-start-5 md:row-span-3 md:row-start-1 md:block" />

                  <div className="col-span-2 mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-2 gap-y-0.5 border-t border-gray-600 pt-2 md:col-span-1 md:col-start-7 md:row-span-3 md:row-start-1 md:mt-0 md:border-t-0 md:pt-0">
                    {[...featuredCredits, ...secondaryDetails].map(
                      (credit, index) => (
                        <div
                          className="contents"
                          key={`${credit.label}-${index}`}
                        >
                          <dt className="font-medium text-gray-100">
                            {credit.label}:
                          </dt>
                          <dd className="m-0 truncate">
                            {credit.href ? (
                              <Link
                                href={credit.href}
                                className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              >
                                {credit.name}
                              </Link>
                            ) : (
                              credit.name
                            )}
                          </dd>
                        </div>
                      )
                    )}
                  </div>

                  <dt className="mt-0.5 font-medium text-gray-100 md:col-start-1 md:row-start-4">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  {genres.length > 0 ? (
                    <dd className="m-0 mt-0.5 line-clamp-2 min-w-0 break-words md:col-span-5 md:col-start-3 md:row-start-4">
                      {genres.map((genre, index) => (
                        <span key={`${genre.href}-${genre.name}`}>
                          {index > 0 && ', '}
                          <Link
                            href={genre.href}
                            className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          >
                            {genre.name}
                          </Link>
                        </span>
                      ))}
                    </dd>
                  ) : (
                    <dd className="m-0 mt-0.5 md:col-span-5 md:col-start-3 md:row-start-4">
                      {notAvailable}
                    </dd>
                  )}
                </dl>
              </div>

              <dl className="mt-2 grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-2 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 text-gray-400 md:relative md:mt-0 md:border-l-0 md:border-t-0 md:pl-3 md:pt-0 md:before:absolute md:before:bottom-1 md:before:left-0 md:before:top-0 md:before:w-px md:before:bg-gray-600">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.requestedByLabel)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/users/${item.request.requestedBy.id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {item.request.requestedBy.displayName}
                  </Link>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.requestedDateTime)}:
                </dt>
                <dd className="m-0 truncate">
                  {createdAt ? (
                    <FormattedDate
                      value={createdAt}
                      dateStyle="medium"
                      timeStyle="short"
                    />
                  ) : (
                    notAvailable
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.serviceLabel)}:
                </dt>
                <dd className="m-0 truncate">
                  {current.service ?? notAvailable}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="mt-1 border-t border-gray-700" />

        <div className="relative mt-[5px] rounded-lg border border-gray-700 bg-gray-900/40 py-[5px]">
          <button
            type="button"
            onClick={() => scrollTimeline(-1)}
            className="absolute left-1 top-1/2 z-10 flex h-10 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-indigo-400/40 bg-gray-900/80 text-indigo-200 backdrop-blur-sm md:hidden"
            aria-label={intl.formatMessage(messages.scrollProgressLeft)}
          >
            <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <div
            ref={timelineRef}
            className="hide-scrollbar flex overflow-x-auto px-2"
            aria-label={intl.formatMessage(messages.requestLifecycle)}
          >
            <div className="mx-auto flex min-w-[640px] flex-1 items-start justify-center">
              {timelineStages.map((stage, index) => {
                const isAvailable = currentStage === 'available';
                const isCurrent =
                  !terminalWithoutProgress &&
                  !isAvailable &&
                  currentStage === stage;
                const isComplete =
                  !terminalWithoutProgress &&
                  (isAvailable ? index <= activeIndex : index < activeIndex);
                return (
                  <div
                    key={stage}
                    className="relative flex min-w-[80px] flex-1 flex-col items-center text-center"
                  >
                    {index < timelineStages.length - 1 && (
                      <span
                        className={`absolute left-1/2 right-[-50%] top-[6px] h-0.5 ${
                          !terminalWithoutProgress && index < activeIndex
                            ? 'bg-emerald-400'
                            : 'bg-gray-700'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative z-[1] flex h-[14px] w-[14px] items-center justify-center rounded-full border ${
                        isCurrent
                          ? 'border-indigo-300 bg-indigo-500 text-white shadow-sm shadow-indigo-900/50'
                          : isComplete
                            ? 'border-emerald-400 bg-emerald-500 text-white'
                            : 'border-gray-600 bg-gray-800 text-gray-500'
                      }`}
                    >
                      {isComplete ? (
                        <CheckIcon className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : isCurrent ? (
                        <StageIcon className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span
                      className={`mt-1 whitespace-nowrap text-[11px] leading-4 ${
                        isCurrent ? 'font-semibold text-white' : 'text-gray-400'
                      }`}
                    >
                      {getStageLabel(intl, stage)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => scrollTimeline(1)}
            className="absolute right-1 top-1/2 z-10 flex h-10 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-indigo-400/40 bg-gray-900/80 text-indigo-200 backdrop-blur-sm md:hidden"
            aria-label={intl.formatMessage(messages.scrollProgressRight)}
          >
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {current.stage === 'downloading' && current.percent !== null && (
          <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-indigo-200">
              <span className="inline-flex items-center gap-2">
                <span>
                  {intl.formatMessage(messages.progressFrom, {
                    percent: current.percent.toFixed(1).replace(/\.0$/, ''),
                  })}
                </span>
                {current.size !== null && current.sizeLeft !== null && (
                  <>
                    <span className="text-gray-500" aria-hidden="true">
                      |
                    </span>
                    <span>
                      {intl.formatMessage(messages.sizeProgress, {
                        complete: formatBytes(
                          intl,
                          current.size - current.sizeLeft
                        ),
                        total: formatBytes(intl, current.size),
                      })}
                    </span>
                  </>
                )}
              </span>
              {estimatedCompletionTime && (
                <span>
                  {intl.formatMessage(messages.eta, {
                    date: (
                      <FormattedDate
                        value={estimatedCompletionTime}
                        dateStyle="short"
                        timeStyle="short"
                      />
                    ),
                  })}
                </span>
              )}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-gray-700"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={current.percent}
              aria-valuetext={`${current.percent}%`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${Math.min(100, Math.max(0, current.percent))}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-[5px]">
          <Tooltip content={current.message}>
            <span
              className={`inline-flex h-[22px] w-32 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${stageTone[currentStage] ?? stageTone.cancelled}`}
              aria-label={`${getStageLabel(intl, currentStage)}: ${current.message}`}
              tabIndex={0}
            >
              <StageIcon className="h-3 w-3" aria-hidden="true" />
              {getStageLabel(intl, currentStage)}
            </span>
          </Tooltip>
          {actionControls}
          <button
            type="button"
            className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-gray-600 bg-gray-900 px-2 text-[11px] font-medium text-gray-300 transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-expanded={isHistoryOpen}
            onClick={() => onToggleHistory(item.request.id)}
          >
            <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isHistoryOpen ? messages.hideHistory : messages.history
            )}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${isHistoryOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {isHistoryOpen && (
          <section className="mt-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
            <h4 className="mb-2 text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.history)}
            </h4>
            {chronologicalHistory.length === 0 ? (
              <p className="text-xs text-gray-500">
                {intl.formatMessage(messages.noHistory)}
              </p>
            ) : (
              <ol className="grid grid-cols-[7rem_7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                {chronologicalHistory.map((event) => {
                  const eventDate = getValidDate(event.createdAt);
                  if (!eventDate) {
                    return null;
                  }

                  return (
                    <li key={event.id} className="contents text-xs">
                      <time
                        className="whitespace-nowrap text-gray-500"
                        dateTime={eventDate.toISOString()}
                      >
                        <FormattedDate
                          value={eventDate}
                          hour="numeric"
                          minute="2-digit"
                          second="2-digit"
                        />
                      </time>
                      <span className="font-medium text-gray-200">
                        {getStageLabel(intl, event.stage as StatusStage)}
                      </span>
                      <span className="min-w-0 text-gray-400">
                        {event.message ??
                          getStageLabel(intl, event.stage as StatusStage)}
                        {event.percent !== null && ` · ${event.percent}%`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </article>
    </>
  );
};

const RequestStatus = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { addToast } = useToasts();
  const canUseAdminView = hasPermission(Permission.MANAGE_REQUESTS);
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const [viewToggleTarget, setViewToggleTarget] = useState<HTMLElement | null>(
    null
  );
  const isAdminView = canUseAdminView && viewMode === 'admin';
  const canViewOtherUsers =
    isAdminView &&
    hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
      type: 'or',
    });
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<RequestStatusSortField>('added');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('7d');
  const [selectedUser, setSelectedUser] = useState<UserSelection | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(
    null
  );
  const [retryingRequestId, setRetryingRequestId] = useState<number | null>(
    null
  );
  const [deleteRequestId, setDeleteRequestId] = useState<number | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<number | null>(
    null
  );
  const [removeSelection, setRemoveSelection] =
    useState<RemoveSelection | null>(null);
  const [removingRequestId, setRemovingRequestId] = useState<number | null>(
    null
  );

  useEffect(() => {
    setViewToggleTarget(document.getElementById('request-status-view-toggle'));
  }, []);

  const { data: statusUsers } = useSWR<RequestStatusUsersResponse>(
    canViewOtherUsers ? '/api/v1/request/status/users?take=100&skip=0' : null,
    fetchStatusUsers
  );

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    setFilter(getSafeQueryValue(router.query.filter, requestTypeFilterValues));
    setMediaFilter(
      getSafeQueryValue(router.query.mediaType, mediaTypeValues) as MediaFilter
    );
    const queryMediaFilter = getSafeQueryValue(
      router.query.mediaType,
      mediaTypeValues
    ) as MediaFilter;
    const querySort = getSafeQueryValue(
      router.query.sort,
      getSortOptions(queryMediaFilter).map((option) => option.value)
    );
    setSort(
      querySort === 'all' ? 'added' : (querySort as RequestStatusSortField)
    );
    const querySortDirection = getSafeQueryValue(
      router.query.sortDirection,
      sortDirectionValues
    );
    setSortDirection(querySortDirection === 'asc' ? 'asc' : 'desc');
    setTimeFrame(getTimeFrameFromQuery(router.query.timeFrame));

    const rawUserId = Array.isArray(router.query.userId)
      ? router.query.userId[0]
      : router.query.userId;
    if (canViewOtherUsers) {
      if (rawUserId === 'all') {
        setSelectedUser('all');
      } else if (rawUserId && /^\d+$/.test(rawUserId)) {
        const userId = Number(rawUserId);
        setSelectedUser(userId > 0 ? userId : (currentUser?.id ?? null));
      } else {
        setSelectedUser(currentUser?.id ?? null);
      }
    } else {
      setSelectedUser(null);
    }
  }, [
    canViewOtherUsers,
    currentUser?.id,
    router.isReady,
    router.query.filter,
    router.query.mediaType,
    router.query.sort,
    router.query.sortDirection,
    router.query.timeFrame,
    router.query.userId,
  ]);

  const userOptions = useMemo(() => {
    const users = new Map<
      number,
      RequestStatusUsersResponse['results'][number]
    >();
    for (const user of statusUsers?.results ?? []) {
      users.set(user.id, user);
    }
    if (currentUser) {
      users.set(currentUser.id, {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
      });
    }
    return [...users.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: 'base',
      })
    );
  }, [currentUser, statusUsers]);

  const selectedOwnerId = canViewOtherUsers
    ? selectedUser === 'all'
      ? undefined
      : (selectedUser ?? currentUser?.id)
    : currentUser?.id;
  const page = Math.max(Number(router.query.page) || 1, 1);
  const pageSize = 25;
  const apiMediaType =
    mediaFilter === 'book' || mediaFilter === 'audiobook'
      ? 'book'
      : mediaFilter;
  const bookFormat =
    mediaFilter === 'book'
      ? 'ebook'
      : mediaFilter === 'audiobook'
        ? 'audiobook'
        : undefined;
  const query = useMemo(() => {
    if (
      !canLoadRequestStatus({
        currentUserId: currentUser?.id,
        canViewOtherUsers,
        selectedUser,
      })
    ) {
      return null;
    }

    const params = new URLSearchParams({
      take: String(pageSize),
      skip: String((page - 1) * pageSize),
      filter,
      mediaType: apiMediaType,
      sort,
      sortDirection,
      timeFrame,
    });
    if (bookFormat) {
      params.set('bookFormat', bookFormat);
    }
    if (selectedOwnerId !== undefined) {
      params.set('requestedBy', String(selectedOwnerId));
    }
    return `/api/v1/request/status?${params.toString()}`;
  }, [
    apiMediaType,
    bookFormat,
    canViewOtherUsers,
    currentUser,
    filter,
    page,
    selectedOwnerId,
    selectedUser,
    sort,
    sortDirection,
    timeFrame,
  ]);
  const { data, error, isValidating, mutate } =
    useSWR<RequestStatusResultsResponse>(query, {
      refreshInterval: 15000,
      revalidateOnFocus: true,
    });
  useRequestStatusScrollRestoration(Boolean(data));

  const routeQuery = ({
    nextFilter = filter,
    nextMediaFilter = mediaFilter,
    nextSort = sort,
    nextSortDirection = sortDirection,
    nextTimeFrame = timeFrame,
    nextUser = selectedUser,
    nextPage = 1,
  }: {
    nextFilter?: string;
    nextMediaFilter?: MediaFilter;
    nextSort?: RequestStatusSortField;
    nextSortDirection?: 'asc' | 'desc';
    nextTimeFrame?: TimeFrame;
    nextUser?: UserSelection | null;
    nextPage?: number;
  } = {}) => ({
    ...(nextFilter !== 'all' ? { filter: nextFilter } : {}),
    ...(nextMediaFilter !== 'all' ? { mediaType: nextMediaFilter } : {}),
    ...(nextSort !== 'added' ? { sort: nextSort } : {}),
    ...(nextSortDirection !== 'desc'
      ? { sortDirection: nextSortDirection }
      : {}),
    ...(nextTimeFrame !== '7d' ? { timeFrame: nextTimeFrame } : {}),
    ...(canViewOtherUsers && nextUser !== null
      ? { userId: nextUser === 'all' ? 'all' : String(nextUser) }
      : {}),
    ...(nextPage > 1 ? { page: String(nextPage) } : {}),
  });

  const pushRouteQuery = (queryParams: Record<string, string>) => {
    void router.push({ pathname: router.pathname, query: queryParams });
  };

  const updateFilter = (nextFilter: string) => {
    setFilter(nextFilter);
    pushRouteQuery(routeQuery({ nextFilter }));
  };

  const updateMediaFilter = (nextMediaFilter: MediaFilter) => {
    const options = getSortOptions(nextMediaFilter);
    const keepsSort = options.some((option) => option.value === sort);
    const nextSort = keepsSort ? sort : 'added';
    const nextSortDirection = keepsSort ? sortDirection : 'desc';
    setMediaFilter(nextMediaFilter);
    setSort(nextSort);
    setSortDirection(nextSortDirection);
    pushRouteQuery(
      routeQuery({ nextMediaFilter, nextSort, nextSortDirection })
    );
  };

  const updateSort = (nextSort: RequestStatusSortField) => {
    const nextSortDirection =
      sort === nextSort
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : getDefaultSortDirection(nextSort);
    setSort(nextSort);
    setSortDirection(nextSortDirection);
    pushRouteQuery(routeQuery({ nextSort, nextSortDirection }));
  };

  const updateUser = (value: string) => {
    const nextUser: UserSelection = value === 'all' ? 'all' : Number(value);
    setSelectedUser(nextUser);
    pushRouteQuery(routeQuery({ nextUser }));
  };

  const updateViewMode = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    const nextUser: UserSelection =
      nextViewMode === 'admin' ? 'all' : (currentUser?.id ?? 0);
    setSelectedUser(nextUser);
    const nextQuery = routeQuery({ nextUser });

    if (nextViewMode === 'admin') {
      nextQuery.userId = 'all';
    } else {
      delete nextQuery.userId;
    }

    pushRouteQuery(nextQuery);
  };

  const updateTimeFrame = (nextTimeFrame: TimeFrame) => {
    setTimeFrame(nextTimeFrame);
    pushRouteQuery(routeQuery({ nextTimeFrame }));
  };

  const retryRequest = async (requestId: number) => {
    setRetryingRequestId(requestId);
    try {
      await axios.post(`/api/v1/request/${requestId}/retry`);
      addToast(intl.formatMessage(messages.retrySuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      await mutate();
    } catch {
      addToast(intl.formatMessage(messages.retryFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setRetryingRequestId(null);
    }
  };

  const deleteRequest = async () => {
    if (deleteRequestId === null) return;
    const requestId = deleteRequestId;
    setDeletingRequestId(requestId);
    try {
      await axios.delete(`/api/v1/request/${requestId}/status`);
      addToast(intl.formatMessage(messages.deleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setExpandedRequestId((currentId) =>
        currentId === requestId ? null : currentId
      );
      setDeleteRequestId(null);
      await mutate();
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message
        : undefined;
      addToast(
        detail
          ? `${intl.formatMessage(messages.deleteFailed)} ${detail}`
          : intl.formatMessage(messages.deleteFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setDeletingRequestId(null);
    }
  };

  const openRemoveRequest = (
    requestId: number,
    title: string,
    service: string
  ) => {
    const item = data?.results.find(
      (result) => result.request.id === requestId
    );
    const mediaId = item?.request.media?.id;

    if (!item || !mediaId) {
      addToast(intl.formatMessage(messages.removeFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setRemoveSelection({
      requestId,
      mediaId,
      title,
      service,
      is4k: item.request.is4k,
      format:
        item.request.type === 'book'
          ? getRequestedBookFormat(item.request.bookFormat)
          : undefined,
    });
  };

  const removeRequestFromLibrary = async () => {
    if (!removeSelection) return;

    const selection = removeSelection;
    setRemovingRequestId(selection.requestId);
    try {
      const params = new URLSearchParams({
        is4k: String(selection.is4k),
      });
      if (selection.format) {
        params.set('format', selection.format);
      }

      await axios.delete(
        `/api/v1/media/${selection.mediaId}/file?${params.toString()}`
      );
      addToast(intl.formatMessage(messages.removeSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setRemoveSelection(null);
      await mutate();
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message
        : undefined;
      addToast(
        detail
          ? `${intl.formatMessage(messages.removeFailed)} ${detail}`
          : intl.formatMessage(messages.removeFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setRemovingRequestId(null);
    }
  };

  if (!data && !error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        <LoadingSpinner />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        <div
          className="mt-8 flex flex-col items-start gap-4 rounded-xl border border-red-500/50 bg-red-500/10 p-6 text-red-100 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="font-medium">
              {intl.formatMessage(messages.loadError)}
            </p>
            <p className="mt-1 text-sm text-red-100/80">
              {intl.formatMessage(messages.loadErrorHint)}
            </p>
          </div>
          <Button
            buttonType="warning"
            buttonSize="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
          >
            <ArrowPathIcon
              className={`mr-1.5 h-4 w-4 ${isValidating ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {intl.formatMessage(
              isValidating ? messages.refreshing : messages.retryLoad
            )}
          </Button>
        </div>
      </>
    );
  }

  const totalPages = Math.max(data.pageInfo.pages, 1);
  const sortOptions = getSortOptions(mediaFilter);
  const mediaFilters: {
    value: MediaFilter;
    label: keyof typeof messages;
  }[] = [
    { value: 'all', label: 'allMedia' },
    { value: 'movie', label: 'movies' },
    { value: 'tv', label: 'series' },
    { value: 'music', label: 'music' },
    { value: 'book', label: 'ebooks' },
    { value: 'audiobook', label: 'audiobooks' },
  ];
  const changePage = (nextPage: number) => {
    pushRouteQuery(routeQuery({ nextPage }));
  };
  const selectedTaskFilter =
    filter === 'completed'
      ? 'completed'
      : filter === 'processing'
        ? 'active'
        : filter === 'attention'
          ? 'attention'
          : 'all';
  const hasFilters =
    filter !== 'all' ||
    mediaFilter !== 'all' ||
    sort !== 'added' ||
    sortDirection !== 'desc' ||
    timeFrame !== '7d' ||
    (canViewOtherUsers &&
      (selectedUser === 'all' || selectedUser !== currentUser?.id));
  const clearFilters = () => {
    setFilter('all');
    setMediaFilter('all');
    setSort('added');
    setSortDirection('desc');
    setTimeFrame('7d');
    setSelectedUser(currentUser?.id ?? null);
    pushRouteQuery({});
  };

  return (
    <>
      {deleteRequestId !== null && (
        <Transition
          as="div"
          enter="transition-opacity duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          show
        >
          <Modal
            title={intl.formatMessage(messages.deleteTitle)}
            okText={intl.formatMessage(messages.delete)}
            okButtonType="danger"
            loading={deletingRequestId !== null}
            onOk={() => void deleteRequest()}
            onCancel={() => setDeleteRequestId(null)}
          >
            <p>{intl.formatMessage(messages.deleteDescription)}</p>
          </Modal>
        </Transition>
      )}
      {removeSelection && (
        <Transition
          as="div"
          enter="transition-opacity duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          show
        >
          <Modal
            title={intl.formatMessage(messages.removeTitle, {
              service: removeSelection.service,
            })}
            okText={intl.formatMessage(messages.remove)}
            okButtonType="danger"
            loading={removingRequestId !== null}
            onOk={() => void removeRequestFromLibrary()}
            onCancel={() => setRemoveSelection(null)}
          >
            <p>
              {intl.formatMessage(messages.removeDescription, {
                title: removeSelection.title,
                service: removeSelection.service,
              })}
            </p>
          </Modal>
        </Transition>
      )}
      <PageTitle title={intl.formatMessage(messages.title)} />
      {canUseAdminView &&
        viewToggleTarget &&
        createPortal(
          <div
            className="inline-flex flex-shrink-0 rounded-lg border border-gray-600 bg-gray-800 p-0.5"
            role="group"
            aria-label={intl.formatMessage(messages.viewMode)}
          >
            <button
              type="button"
              className={`h-8 rounded-md px-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${isAdminView ? 'bg-indigo-500 text-white' : 'text-gray-300 hover:text-white'}`}
              aria-pressed={isAdminView}
              onClick={() => updateViewMode('admin')}
            >
              {intl.formatMessage(messages.adminView)}
            </button>
            <button
              type="button"
              className={`h-8 rounded-md px-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${!isAdminView ? 'bg-indigo-500 text-white' : 'text-gray-300 hover:text-white'}`}
              aria-pressed={!isAdminView}
              onClick={() => updateViewMode('user')}
            >
              {intl.formatMessage(messages.userView)}
            </button>
          </div>,
          viewToggleTarget
        )}
      <div className="mt-8 flex items-start justify-between gap-4">
        <h2
          className="min-w-0 flex-1 truncate text-2xl font-bold leading-7 text-gray-100 sm:overflow-visible sm:text-4xl sm:leading-9"
          data-testid="page-header"
        >
          <span className="text-overseerr">
            {intl.formatMessage(messages.title)}
          </span>
        </h2>
        {isAdminView && canViewOtherUsers && (
          <label className="inline-flex h-8 flex-shrink-0 self-start overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
            <span className="inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap border-r border-gray-600 px-1.5 text-xs font-semibold text-indigo-100">
              {intl.formatMessage(messages.userFilter)}
            </span>
            <select
              className="w-28 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
              value={selectedUser ?? currentUser?.id ?? ''}
              onChange={(event) => updateUser(event.target.value)}
              aria-label={intl.formatMessage(messages.selectUser)}
            >
              <option value="all">
                {intl.formatMessage(messages.allUsers)}
              </option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && (
        <div
          className="mb-5 flex flex-col items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>{intl.formatMessage(messages.loadErrorHint)}</span>
          <Button
            buttonType="default"
            buttonSize="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
          >
            {intl.formatMessage(
              isValidating ? messages.refreshing : messages.retryLoad
            )}
          </Button>
        </div>
      )}

      <section
        className="mb-5 mt-4"
        aria-label={intl.formatMessage(messages.taskFilters)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.taskFilters)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            {
              key: 'all',
              filter: 'all',
              label: messages.all,
              value: data.counts.total,
            },
            {
              key: 'completed',
              filter: 'completed',
              label: messages.completed,
              value: data.counts.completed,
            },
            {
              key: 'active',
              filter: 'processing',
              label: messages.active,
              value: data.counts.active,
            },
            {
              key: 'attention',
              filter: 'attention',
              label: messages.attention,
              value: data.counts.attention,
            },
          ].map((summary) => (
            <button
              key={summary.key}
              type="button"
              onClick={() => updateFilter(summary.filter)}
              className={`inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${selectedTaskFilter === summary.key ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'}`}
            >
              <span>{intl.formatMessage(summary.label)}</span>
              <span className="rounded-full bg-gray-950/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-gray-100">
                {summary.value}
              </span>
            </button>
          ))}
          <label className="inline-flex h-8 flex-shrink-0 overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
            <span className="inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap border-r border-gray-600 px-1.5 text-xs font-semibold text-indigo-100">
              {intl.formatMessage(messages.statusFilter)}
            </span>
            <select
              className="w-28 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
              value={filter}
              onChange={(event) => updateFilter(event.target.value)}
              aria-label={intl.formatMessage(messages.statusFilter)}
            >
              {[
                'all',
                'pending',
                'completed',
                'processing',
                'attention',
                'failed',
                'available',
                'unavailable',
              ].map((value) => (
                <option key={value} value={value}>
                  {intl.formatMessage(
                    value === 'unavailable'
                      ? messages.noReleaseFoundFilter
                      : messages[value as keyof typeof messages]
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex h-8 flex-shrink-0 overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
            <span className="inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap border-r border-gray-600 px-1.5 text-xs font-semibold text-indigo-100">
              {intl.formatMessage(messages.timeFrame)}
            </span>
            <select
              className="w-24 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
              value={timeFrame}
              onChange={(event) =>
                updateTimeFrame(event.target.value as TimeFrame)
              }
              aria-label={intl.formatMessage(messages.timeFrame)}
            >
              <option value="7d">
                {intl.formatMessage(messages.last7Days)}
              </option>
              <option value="14d">
                {intl.formatMessage(messages.last14Days)}
              </option>
              <option value="30d">
                {intl.formatMessage(messages.last30Days)}
              </option>
              <option value="6m">
                {intl.formatMessage(messages.last6Months)}
              </option>
              <option value="all">
                {intl.formatMessage(messages.allTime)}
              </option>
            </select>
          </label>
        </div>
      </section>

      <section
        className="mb-5"
        aria-label={intl.formatMessage(messages.filter)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.filter)}
        </div>
        <div className="flex flex-wrap items-center gap-2 align-middle">
          {mediaFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mediaFilter === option.value}
              onClick={() => updateMediaFilter(option.value)}
              className={`h-8 whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${mediaFilter === option.value ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'}`}
            >
              {intl.formatMessage(messages[option.label])}
            </button>
          ))}
        </div>
        {(mediaFilter === 'book' || mediaFilter === 'audiobook') && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span>{intl.formatMessage(messages.showingFormat)}</span>
            <BookFormatBadge
              format={mediaFilter === 'book' ? 'ebook' : 'audiobook'}
              variant="inline"
            />
          </div>
        )}
      </section>

      {timeFrame !== 'all' && data.olderCount > 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-indigo-400/40 bg-indigo-500/10 p-3 text-sm text-indigo-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <ClockIcon
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-300"
              aria-hidden="true"
            />
            <span>
              {intl.formatMessage(messages.olderRequests, {
                count: data.olderCount,
              })}
            </span>
          </div>
          <Button
            buttonType="default"
            buttonSize="sm"
            onClick={() => updateTimeFrame('all')}
          >
            {intl.formatMessage(messages.viewAllHistory)}
          </Button>
        </div>
      )}

      <section className="mb-5">
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortOptions.map((option) => {
            const active = sort === option.value;
            const displayedDirection = active
              ? sortDirection
              : getDefaultSortDirection(option.value);
            const DirectionIcon =
              displayedDirection === 'asc'
                ? BarsArrowUpIcon
                : BarsArrowDownIcon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                aria-label={`${intl.formatMessage(messages[option.label])} (${intl.formatMessage(active && sortDirection === 'asc' ? messages.sortAscending : messages.sortDescending)})`}
                onClick={() => updateSort(option.value)}
                className={`inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${active ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'}`}
              >
                {intl.formatMessage(messages[option.label])}
                <DirectionIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <div className="space-y-4">
        {data.results.map((item) => (
          <RequestStatusCard
            key={item.request.id}
            item={item}
            isAdminView={isAdminView}
            onRetry={retryRequest}
            isRetrying={retryingRequestId === item.request.id}
            onDelete={setDeleteRequestId}
            isDeleting={deletingRequestId === item.request.id}
            onRemove={openRemoveRequest}
            isRemoving={removingRequestId === item.request.id}
            isHistoryOpen={expandedRequestId === item.request.id}
            onToggleHistory={(requestId) =>
              setExpandedRequestId((currentId) =>
                currentId === requestId ? null : requestId
              )
            }
          />
        ))}
      </div>

      {data.results.length === 0 && (
        <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-700 bg-gray-800/40 p-6 text-center text-gray-400">
          <span>{intl.formatMessage(messages.noResults)}</span>
          {hasFilters && (
            <Button buttonType="default" buttonSize="sm" onClick={clearFilters}>
              {intl.formatMessage(messages.clearFilters)}
            </Button>
          )}
        </div>
      )}

      <nav
        className="mt-6 flex items-center justify-between"
        aria-label={intl.formatMessage(messages.pagination)}
      >
        <Button
          disabled={page <= 1}
          onClick={() => changePage(page - 1)}
          buttonSize="sm"
        >
          <ChevronLeftIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.previous)}
        </Button>
        <span className="text-sm text-gray-400">
          {intl.formatMessage(messages.page, { page, pages: totalPages })}
        </span>
        <Button
          disabled={page >= totalPages}
          onClick={() => changePage(page + 1)}
          buttonSize="sm"
        >
          {intl.formatMessage(messages.next)}
          <ChevronRightIcon className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </nav>
    </>
  );
};

export default RequestStatus;
