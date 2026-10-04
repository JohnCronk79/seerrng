import type { PlaybackCatalogResponse } from '@server/models/Playback';
import useSWR from 'swr';

const usePlaybackCatalog = (mediaId?: number, is4k = false) =>
  useSWR<PlaybackCatalogResponse>(
    mediaId
      ? `/api/v1/playback/media/${mediaId}${is4k ? '?is4k=true' : ''}`
      : null,
    { shouldRetryOnError: false }
  );

export default usePlaybackCatalog;
