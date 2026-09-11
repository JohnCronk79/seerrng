import { MediaStatus } from '@server/constants/media';
import type { MediaRequestServiceTarget } from '@server/entity/MediaRequest';

interface MusicAvailabilityMedia {
  status?: MediaStatus;
  serviceId?: number | null;
}

interface MusicAvailabilityRequest {
  serviceTargets?: MediaRequestServiceTarget[] | null;
}

interface MusicAvailabilityService {
  id: number;
  name: string;
  activeProfileName: string;
}

export interface AvailableMusicService {
  serverId: number;
  quality: string;
}

export const getAvailableMusicServices = (
  media: MusicAvailabilityMedia | null | undefined,
  requests: MusicAvailabilityRequest[],
  services: MusicAvailabilityService[]
): AvailableMusicService[] => {
  if (!media) {
    return [];
  }

  const availableServerIds = new Set<number>();
  if (media.status === MediaStatus.AVAILABLE && media.serviceId != null) {
    availableServerIds.add(media.serviceId);
  }
  for (const request of requests) {
    for (const target of request.serviceTargets ?? []) {
      if (
        target.serviceType === 'lidarr' &&
        target.format === 'music' &&
        target.status === MediaStatus.AVAILABLE
      ) {
        availableServerIds.add(target.serverId);
      }
    }
  }

  return services.flatMap((service) => {
    if (!availableServerIds.has(service.id)) {
      return [];
    }
    const quality = (service.activeProfileName || service.name).trim();
    return quality
      ? [{ serverId: service.id, quality: quality.toLocaleUpperCase() }]
      : [];
  });
};
