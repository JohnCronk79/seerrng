import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequestServiceTarget } from '@server/entity/MediaRequest';

interface MusicAvailabilityRequest {
  serviceTargets?: MediaRequestServiceTarget[] | null;
}

interface MusicAvailabilityMedia {
  status?: MediaStatus;
  serviceId?: number | null;
  requests?: MusicAvailabilityRequest[];
}

interface MusicAvailabilityService {
  serverId: number;
}

interface BookAvailabilityRequest {
  status: MediaRequestStatus;
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null;
}

export const isBookFormatCoveredByActiveRequest = (
  requests: BookAvailabilityRequest[] | null | undefined,
  selectedFormat: 'ebook' | 'audiobook' | 'both'
): boolean => {
  const activeRequests = (requests ?? []).filter(
    (request) =>
      request.status !== MediaRequestStatus.DECLINED &&
      request.status !== MediaRequestStatus.FAILED &&
      request.status !== MediaRequestStatus.COMPLETED
  );

  return activeRequests.some((request) => {
    const requestFormat = request.bookFormat ?? 'ebook';

    if (selectedFormat === 'both') {
      return true;
    }

    return requestFormat === selectedFormat || requestFormat === 'both';
  });
};

export const isMusicDestinationAvailable = (
  media: MusicAvailabilityMedia | null | undefined,
  selectedServerId: number | null | undefined,
  availableServices: MusicAvailabilityService[] = []
): boolean => {
  if (!media) {
    return false;
  }

  const availableTargets = (media.requests ?? []).flatMap(
    (request) =>
      request.serviceTargets?.filter(
        (target) =>
          target.serviceType === 'lidarr' &&
          target.format === 'music' &&
          target.status === MediaStatus.AVAILABLE
      ) ?? []
  );
  const hasKnownServer =
    media.serviceId != null ||
    availableTargets.length > 0 ||
    availableServices.length > 0;

  if (selectedServerId == null || !hasKnownServer) {
    return media.status === MediaStatus.AVAILABLE;
  }

  return (
    (media.status === MediaStatus.AVAILABLE &&
      media.serviceId === selectedServerId) ||
    availableTargets.some((target) => target.serverId === selectedServerId) ||
    availableServices.some((service) => service.serverId === selectedServerId)
  );
};
