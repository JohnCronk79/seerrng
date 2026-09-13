import { MediaStatus } from '@server/constants/media';
import type { MediaType } from '@server/models/Search';

export type TitleCardQuality = 'HD' | '4K' | 'MP3' | 'FLAC';

export interface TitleCardStatusBadge {
  quality?: TitleCardQuality;
  status: MediaStatus;
  inProgress: boolean;
}

interface GetTitleCardStatusBadgesOptions {
  mediaType: MediaType;
  status?: MediaStatus;
  status4k?: MediaStatus;
  inProgress?: boolean;
  inProgress4k?: boolean;
  availableQualities?: ('MP3' | 'FLAC')[];
}

const hasVisibleStatus = (
  status: MediaStatus | undefined
): status is MediaStatus =>
  status !== undefined && status !== MediaStatus.UNKNOWN;

export const getTitleCardStatusBadges = ({
  mediaType,
  status,
  status4k,
  inProgress = false,
  inProgress4k = false,
  availableQualities,
}: GetTitleCardStatusBadgesOptions): TitleCardStatusBadge[] => {
  if (
    mediaType === 'movie' ||
    mediaType === 'tv' ||
    mediaType === 'collection'
  ) {
    return [
      ...(hasVisibleStatus(status)
        ? [{ quality: 'HD' as const, status, inProgress }]
        : []),
      ...(hasVisibleStatus(status4k)
        ? [
            {
              quality: '4K' as const,
              status: status4k,
              inProgress: inProgress4k,
            },
          ]
        : []),
    ];
  }

  if (mediaType === 'album' && availableQualities?.length) {
    return (['MP3', 'FLAC'] as const)
      .filter((quality) => availableQualities.includes(quality))
      .map((quality) => ({
        quality,
        status: MediaStatus.AVAILABLE,
        inProgress: false,
      }));
  }

  return hasVisibleStatus(status) ? [{ status, inProgress }] : [];
};
