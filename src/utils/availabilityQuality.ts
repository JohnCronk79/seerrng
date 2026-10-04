import { MediaStatus } from '@server/constants/media';

export type AvailableQualityFilter = 'hd' | '4k' | 'mp3' | 'flac';

interface AvailabilityMedia {
  mediaInfo?: {
    status: MediaStatus;
    status4k?: MediaStatus;
  };
  availableQualities?: ('MP3' | 'FLAC')[];
}

const availableStatuses = new Set([
  MediaStatus.AVAILABLE,
  MediaStatus.PARTIALLY_AVAILABLE,
]);

export const matchesAvailableQuality = (
  item: AvailabilityMedia,
  quality: AvailableQualityFilter
) => {
  if (quality === 'mp3' || quality === 'flac') {
    const normalizedQuality = quality === 'mp3' ? 'MP3' : 'FLAC';
    return item.availableQualities?.includes(normalizedQuality) ?? false;
  }

  const status =
    quality === '4k' ? item.mediaInfo?.status4k : item.mediaInfo?.status;

  return status !== undefined && availableStatuses.has(status);
};
