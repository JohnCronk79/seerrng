import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type Media from '@server/entity/Media';

export const getPlaybackMediaRootId = (
  media: Media,
  serverType: MediaServerType,
  is4k: boolean
): string | undefined => {
  if (serverType === MediaServerType.PLEX) {
    if (is4k) {
      return media.ratingKey4k ?? undefined;
    }
    return media.mediaType === MediaType.MUSIC
      ? (media.ratingKeyFlac ??
          media.ratingKeyMp3 ??
          media.ratingKey ??
          undefined)
      : (media.ratingKey ?? undefined);
  }

  if (
    serverType === MediaServerType.JELLYFIN ||
    serverType === MediaServerType.EMBY
  ) {
    if (is4k) {
      return media.jellyfinMediaId4k ?? undefined;
    }
    return media.mediaType === MediaType.MUSIC
      ? (media.jellyfinMediaIdFlac ??
          media.jellyfinMediaIdMp3 ??
          media.jellyfinMediaId ??
          undefined)
      : (media.jellyfinMediaId ?? undefined);
  }

  return undefined;
};
