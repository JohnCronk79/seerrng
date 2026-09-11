import BlocklistBlock from '@app/components/BlocklistBlock';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import SlideOver from '@app/components/Common/SlideOver';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueBlock from '@app/components/IssueBlock';
import RequestBlock from '@app/components/RequestBlock';
import SelectableDownloadList from '@app/components/SelectableDownloadList';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import {
  CheckCircleIcon,
  DocumentMinusIcon,
  ServerIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { BookDetails } from '@server/models/Book';
import type { MusicDetails } from '@server/models/Music';
import axios from 'axios';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ExternalMediaManageSlideOver', {
  manageModalTitle: 'Manage {mediaType}',
  manageModalIssues: 'Open Issues',
  manageModalRequests: 'Requests',
  manageModalMedia: 'Media',
  manageModalAdvanced: 'Advanced',
  downloadstatus: 'Downloads',
  manageModalClearMedia: 'Clear Data',
  manageModalClearMediaWarning:
    '* This will irreversibly remove all local data for this {mediaType}, including any requests.',
  manageModalRemoveMediaWarning:
    '* This will remove this {mediaType} from {arr}, including all files.',
  openarr: 'Open in {arr}',
  openarrFormat: 'Open {format} in {arr}',
  removearr: 'Remove from {arr}',
  removearrFormat: 'Remove {format} from {arr}',
  removearrAll: 'Remove all from {arr}',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  markavailable: 'Mark as Available',
  music: 'music',
  book: 'book',
  musicTitle: 'Music',
  bookTitle: 'Book',
});

const filterDuplicateDownloads = (
  items: NonNullable<MusicDetails['mediaInfo']>['downloadStatus'] = []
) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.downloadId)) return false;
    seen.add(item.downloadId);
    return true;
  });
};

type ExternalMediaManageSlideOverProps = {
  show?: boolean;
  mediaType: MediaType.MUSIC | MediaType.BOOK;
  data: MusicDetails | BookDetails;
  onClose: () => void;
  revalidate: () => void;
};

type ServiceLink = {
  key: string;
  url: string;
  format?: 'ebook' | 'audiobook';
  formatLabel?: string;
};

const ExternalMediaManageSlideOver = ({
  show,
  mediaType,
  data,
  onClose,
  revalidate,
}: ExternalMediaManageSlideOverProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const mediaInfo = data.mediaInfo;
  const arrName = mediaType === MediaType.MUSIC ? 'Lidarr' : 'Bookshelf';
  const externalId =
    mediaType === MediaType.MUSIC
      ? normalizeMusicBrainzId((data as MusicDetails).mbId)
      : normalizeOpenLibraryWorkId(data.id);
  const mediaLabel = intl.formatMessage(
    mediaType === MediaType.MUSIC ? messages.music : messages.book
  );
  const mediaTitleLabel = intl.formatMessage(
    mediaType === MediaType.MUSIC ? messages.musicTitle : messages.bookTitle
  );
  const serviceLinks = (
    [
      mediaInfo?.serviceUrl
        ? {
            key: 'primary',
            url: mediaInfo.serviceUrl,
            format: mediaType === MediaType.BOOK ? 'ebook' : undefined,
            formatLabel:
              mediaType === MediaType.BOOK
                ? intl.formatMessage(messages.ebook)
                : undefined,
          }
        : undefined,
      mediaType === MediaType.BOOK && mediaInfo?.audiobookServiceUrl
        ? {
            key: 'audiobook',
            url: mediaInfo.audiobookServiceUrl,
            format: 'audiobook',
            formatLabel: intl.formatMessage(messages.audiobook),
          }
        : undefined,
    ] as (ServiceLink | undefined)[]
  )
    .map((link) =>
      link ? { ...link, url: getSafeHref(link.url) ?? '' } : undefined
    )
    .filter((link): link is ServiceLink => Boolean(link && link.url));

  const requests =
    mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];
  const downloads = filterDuplicateDownloads(mediaInfo?.downloadStatus);
  const audiobookDownloads =
    mediaType === MediaType.BOOK
      ? filterDuplicateDownloads(mediaInfo?.audiobookDownloadStatus)
      : [];
  const openIssues =
    mediaInfo?.issues?.filter((issue) => issue.status === IssueStatus.OPEN) ??
    [];

  const markAvailable = async () => {
    if (!mediaInfo) {
      return;
    }

    await axios.post(`/api/v1/media/${mediaInfo.id}/available`);
    revalidate();
  };

  const deleteMedia = async () => {
    if (!mediaInfo) {
      return;
    }

    await axios.delete(`/api/v1/media/${mediaInfo.id}`);
    revalidate();
    onClose();
  };

  const deleteMediaFile = async (format?: 'ebook' | 'audiobook' | 'both') => {
    if (!mediaInfo) {
      return;
    }

    const formatQuery =
      mediaType === MediaType.BOOK && format ? `?format=${format}` : '';
    await axios.delete(`/api/v1/media/${mediaInfo.id}/file${formatQuery}`);

    const removedEveryLinkedFormat =
      mediaType !== MediaType.BOOK ||
      format === 'both' ||
      serviceLinks.length <= 1;

    if (removedEveryLinkedFormat) {
      await axios.delete(`/api/v1/media/${mediaInfo.id}`);
    }

    revalidate();
    onClose();
  };

  return (
    <SlideOver
      show={show}
      title={intl.formatMessage(messages.manageModalTitle, {
        mediaType: mediaTitleLabel,
      })}
      onClose={onClose}
      subText={data.title}
    >
      <div className="space-y-6">
        {(downloads.length > 0 || audiobookDownloads.length > 0) && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(messages.downloadstatus)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <SelectableDownloadList
                items={[
                  ...downloads.map((status, index) => {
                    return {
                      id: `standard-${status.downloadId ?? status.externalId ?? index}`,
                      content: (
                        <DownloadBlock
                          downloadItem={{
                            ...status,
                            title: status.title,
                          }}
                          title={data.title}
                          bookFormat={
                            mediaType === MediaType.BOOK ? 'ebook' : undefined
                          }
                        />
                      ),
                    };
                  }),
                  ...audiobookDownloads.map((status, index) => {
                    return {
                      id: `audiobook-${status.downloadId ?? status.externalId ?? index}`,
                      content: (
                        <DownloadBlock
                          downloadItem={{
                            ...status,
                            title: status.title,
                          }}
                          title={data.title}
                          bookFormat="audiobook"
                        />
                      ),
                    };
                  }),
                ]}
              />
            </div>
          </div>
        )}

        {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
          type: 'or',
        }) &&
          openIssues.length > 0 && (
            <div>
              <h3 className="mb-2 text-xl font-bold">
                {intl.formatMessage(messages.manageModalIssues)}
              </h3>
              <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                <ul>
                  {openIssues.map((issue) => (
                    <li
                      key={`external-manage-issue-${issue.id}`}
                      className="border-b border-gray-700 last:border-b-0"
                    >
                      <IssueBlock issue={issue} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        {requests.length > 0 && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(messages.manageModalRequests)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <ul>
                {requests.map((request) => (
                  <li
                    key={`external-manage-request-${request.id}`}
                    className="border-b border-gray-700 last:border-b-0"
                  >
                    <RequestBlock request={request} onUpdate={revalidate} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {mediaInfo?.status === MediaStatus.BLOCKLISTED && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(globalMessages.blocklist)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <BlocklistBlock
                externalId={externalId}
                mediaType={mediaType}
                onUpdate={revalidate}
                onDelete={onClose}
              />
            </div>
          </div>
        )}

        {hasPermission(Permission.ADMIN) && serviceLinks.length > 0 && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(messages.manageModalMedia)}
            </h3>
            <div className="space-y-2">
              {serviceLinks.map((link) => (
                <a
                  key={`external-service-link-${link.key}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  <Button buttonType="ghost" className="w-full">
                    <ServerIcon />
                    <span>
                      {link.format
                        ? intl.formatMessage(messages.openarrFormat, {
                            arr: arrName,
                            format: link.formatLabel,
                          })
                        : intl.formatMessage(messages.openarr, {
                            arr: arrName,
                          })}
                    </span>
                  </Button>
                </a>
              ))}
              {mediaType === MediaType.BOOK &&
                serviceLinks.map((link) => (
                  <div key={`external-remove-${link.key}`}>
                    <ConfirmButton
                      onClick={() => deleteMediaFile(link.format)}
                      confirmText={intl.formatMessage(
                        globalMessages.areyousure
                      )}
                      className="w-full"
                    >
                      <TrashIcon />
                      <span>
                        {intl.formatMessage(messages.removearrFormat, {
                          arr: arrName,
                          format: link.formatLabel,
                        })}
                      </span>
                    </ConfirmButton>
                  </div>
                ))}
              <div>
                <ConfirmButton
                  onClick={() =>
                    deleteMediaFile(
                      mediaType === MediaType.BOOK ? 'both' : undefined
                    )
                  }
                  confirmText={intl.formatMessage(globalMessages.areyousure)}
                  className="w-full"
                >
                  <TrashIcon />
                  <span>
                    {intl.formatMessage(
                      mediaType === MediaType.BOOK && serviceLinks.length > 1
                        ? messages.removearrAll
                        : messages.removearr,
                      { arr: arrName }
                    )}
                  </span>
                </ConfirmButton>
                <div className="mt-1 text-xs text-gray-400">
                  {intl.formatMessage(messages.manageModalRemoveMediaWarning, {
                    mediaType: mediaLabel,
                    arr: arrName,
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {hasPermission(Permission.ADMIN) &&
          mediaInfo &&
          mediaInfo.status !== MediaStatus.BLOCKLISTED && (
            <div>
              <h3 className="mb-2 text-xl font-bold">
                {intl.formatMessage(messages.manageModalAdvanced)}
              </h3>
              <div className="space-y-2">
                {mediaInfo.status !== MediaStatus.AVAILABLE && (
                  <Button
                    onClick={markAvailable}
                    className="w-full"
                    buttonType="success"
                  >
                    <CheckCircleIcon />
                    <span>{intl.formatMessage(messages.markavailable)}</span>
                  </Button>
                )}
                <div>
                  <ConfirmButton
                    onClick={deleteMedia}
                    confirmText={intl.formatMessage(globalMessages.areyousure)}
                    className="w-full"
                  >
                    <DocumentMinusIcon />
                    <span>
                      {intl.formatMessage(messages.manageModalClearMedia)}
                    </span>
                  </ConfirmButton>
                  <div className="mt-2 text-xs text-gray-400">
                    {intl.formatMessage(messages.manageModalClearMediaWarning, {
                      mediaType: mediaLabel,
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </SlideOver>
  );
};

export default ExternalMediaManageSlideOver;
