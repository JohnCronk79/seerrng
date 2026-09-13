import { MediaStatus } from '@server/constants/media';
import type { MediaRequestServiceTarget } from '@server/entity/MediaRequest';

interface MusicAvailabilityMedia {
  status?: MediaStatus;
  serviceId?: number | null;
  availableMusicServiceIds?: number[] | null;
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
  if (media.availableMusicServiceIds != null) {
    for (const serverId of media.availableMusicServiceIds ?? []) {
      if (Number.isSafeInteger(serverId) && serverId >= 0) {
        availableServerIds.add(serverId);
      }
    }
  } else if (
    media.status === MediaStatus.AVAILABLE &&
    media.serviceId != null
  ) {
    // Compatibility for rows created before per-destination availability was
    // persisted. The next complete Lidarr scan replaces this fallback.
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

export const getAvailableMusicQualities = (
  media: MusicAvailabilityMedia | null | undefined,
  requests: MusicAvailabilityRequest[],
  services: MusicAvailabilityService[]
): ('MP3' | 'FLAC')[] => {
  const availableServiceQualities = getAvailableMusicServices(
    media,
    requests,
    services
  ).map((service) => service.quality.toLocaleUpperCase());

  return (['MP3', 'FLAC'] as const).filter((quality) =>
    availableServiceQualities.some((serviceQuality) =>
      serviceQuality.includes(quality)
    )
  );
};
