import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import AvailabilityValue, {
  getMediaAvailabilityTone,
} from '@app/components/MediaDetails/AvailabilityValue';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ComicDetails as ComicDetailsType } from '@server/models/Comic';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.ComicDetails', {
  publisher: 'Publisher',
  issueCount: 'Issues',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  viewrequest: 'View Request',
  viewOnComicVine: 'View on ComicVine',
  notAvailable: 'Not available',
});

const ComicDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const comicId =
    typeof router.query.comicId === 'string' ? router.query.comicId : '';

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<ComicDetailsType>(
    comicId ? `/api/v1/comic/${encodeApiPathSegment(comicId)}` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_COMIC],
    { type: 'or' }
  );
  const isAvailable =
    data.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const activeRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const activeRequest =
    activeRequests.find((request) => request.requestedBy?.id === user?.id) ??
    (hasPermission(Permission.MANAGE_REQUESTS) && activeRequests.length === 1
      ? activeRequests[0]
      : undefined);
  const canShowRequestButton =
    canRequest &&
    !isAvailable &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    !activeRequest;
  const notAvailable = intl.formatMessage(messages.notAvailable);

  return (
    <>
      <PageTitle title={data.title} />
      {showRequestModal && (
        <RequestModal
          comicId={data.id}
          editRequest={editRequest}
          show={showRequestModal}
          type="comic"
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            revalidate();
          }}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
        />
      )}
      <div className="media-page">
        <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
          {data.posterPath && (
            <MediaDetailArtwork src={data.posterPath} type="tmdb" />
          )}
          <div className="relative z-10">
            <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
              <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
                <CachedImage
                  type="tmdb"
                  src={data.posterPath || '/images/seerr_poster_not_found.png'}
                  alt=""
                  fill
                  priority
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg leading-5 font-semibold text-white">
                  {data.title}
                  {data.startYear ? ` (${data.startYear})` : ''}
                </h1>
                <dl className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4">
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.publisher)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {data.publisher || notAvailable}
                  </dd>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.issueCount)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {data.issueCount
                      ? intl.formatNumber(data.issueCount)
                      : notAvailable}
                  </dd>
                  {data.mediaInfo?.status !== undefined && (
                    <>
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(globalMessages.request)}:
                      </dt>
                      <dd className="m-0 truncate">
                        <AvailabilityValue
                          tone={getMediaAvailabilityTone(
                            data.mediaInfo?.status
                          )}
                        >
                          {isAvailable
                            ? intl.formatMessage(globalMessages.available)
                            : activeRequest
                              ? intl.formatMessage(globalMessages.requested)
                              : intl.formatMessage(globalMessages.notrequested)}
                        </AvailabilityValue>
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </div>

            <div className="media-primary-action-row">
              {data.siteDetailUrl && (
                <a
                  href={data.siteDetailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="app-button-default inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  {intl.formatMessage(messages.viewOnComicVine)}
                </a>
              )}
              {activeRequest && (
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => {
                    setEditRequest(activeRequest);
                    setShowRequestModal(true);
                  }}
                >
                  <InformationCircleIcon />
                  <span>{intl.formatMessage(messages.viewrequest)}</span>
                </Button>
              )}
              {canShowRequestButton && (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={() => {
                    setEditRequest(undefined);
                    setShowRequestModal(true);
                  }}
                >
                  <ArrowDownTrayIcon />
                  <span>{intl.formatMessage(globalMessages.request)}</span>
                </Button>
              )}
            </div>

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading">
                {intl.formatMessage(messages.overview)}
              </h2>
              <p className="refreshed-detail-text-muted mt-4 max-w-none text-sm leading-5">
                {data.description ||
                  data.deck ||
                  intl.formatMessage(messages.overviewUnavailable)}
              </p>
            </section>
          </div>
        </article>
        <div className="extra-bottom-space relative" />
      </div>
    </>
  );
};

export default ComicDetails;
