import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import AvailabilityValue, {
  getMediaAvailabilityTone,
} from '@app/components/MediaDetails/AvailabilityValue';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { MagazineDetails as MagazineDetailsType } from '@server/models/Magazine';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.MagazineDetails', {
  status: 'Request status',
  issueCount: 'Issues',
  issueList: 'Known issues',
  issueDate: 'Issue date',
  issueAvailable: 'Available',
  issueMissing: 'Not available',
  noIssues: 'LazyLibrarian has no issue details for this title yet.',
  viewRequest: 'View Request',
  requestMagazine: 'Request Magazine',
  notAvailable: 'Not available',
});

const MagazineDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const title =
    typeof router.query.title === 'string' ? router.query.title : '';
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MagazineDetailsType>(
    title ? `/api/v1/magazine/${encodeApiPathSegment(title)}` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }
  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MAGAZINE],
    { type: 'or' }
  );
  const isAvailable =
    data.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const isProcessing = data.mediaInfo?.status === MediaStatus.PROCESSING;
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
    !isProcessing &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    !activeRequest;
  const notAvailable = intl.formatMessage(messages.notAvailable);

  return (
    <>
      <PageTitle title={data.title} />
      {showRequestModal && (
        <RequestModal
          magazineTitle={data.title}
          editRequest={editRequest}
          show
          type="magazine"
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            void revalidate();
          }}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
        />
      )}
      <div className="media-page">
        <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
          <div className="relative z-10">
            <h1 className="text-lg leading-5 font-semibold text-white">
              {data.title}
            </h1>
            <dl className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issueCount)}:
              </dt>
              <dd className="m-0 truncate">
                {data.issueCount !== undefined
                  ? intl.formatNumber(data.issueCount)
                  : notAvailable}
              </dd>
              {data.mediaInfo?.status !== undefined && (
                <>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.status)}:
                  </dt>
                  <dd className="m-0 truncate">
                    <AvailabilityValue
                      tone={getMediaAvailabilityTone(data.mediaInfo.status)}
                    >
                      {isAvailable
                        ? intl.formatMessage(globalMessages.available)
                        : activeRequest || isProcessing
                          ? intl.formatMessage(globalMessages.requested)
                          : intl.formatMessage(globalMessages.notrequested)}
                    </AvailabilityValue>
                  </dd>
                </>
              )}
            </dl>

            <div className="media-primary-action-row">
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
                  <span>{intl.formatMessage(messages.viewRequest)}</span>
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
                  <span>{intl.formatMessage(messages.requestMagazine)}</span>
                </Button>
              )}
            </div>

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading">
                {intl.formatMessage(messages.issueList)}
              </h2>
              {data.issues.length > 0 ? (
                <ul className="mt-3 divide-y divide-gray-700">
                  {data.issues.map((issue, index) => (
                    <li
                      key={`${issue.id}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">
                          {issue.id}
                        </div>
                        {issue.date && (
                          <div className="text-xs text-gray-400">
                            {intl.formatMessage(messages.issueDate)}:{' '}
                            {issue.date}
                          </div>
                        )}
                      </div>
                      <AvailabilityValue
                        tone={
                          issue.available
                            ? getMediaAvailabilityTone(MediaStatus.AVAILABLE)
                            : getMediaAvailabilityTone(MediaStatus.UNKNOWN)
                        }
                      >
                        {intl.formatMessage(
                          issue.available
                            ? messages.issueAvailable
                            : messages.issueMissing
                        )}
                      </AvailabilityValue>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="refreshed-detail-text-muted mt-3 text-sm">
                  {intl.formatMessage(messages.noIssues)}
                </p>
              )}
            </section>
          </div>
        </article>
        <div className="extra-bottom-space relative" />
      </div>
    </>
  );
};

export default MagazineDetails;
