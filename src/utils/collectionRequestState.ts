import { MediaRequestStatus, MediaStatus } from '@server/constants/media';

type CollectionRequestStatePart = {
  id: number;
  mediaInfo?: {
    status?: MediaStatus;
    status4k?: MediaStatus;
    requests?: {
      is4k: boolean;
      status: MediaRequestStatus;
    }[];
  };
};

export type CollectionPartRequestPresentation =
  | 'ready'
  | 'requested'
  | 'available'
  | 'blocklisted';

const isActiveRequest = (status: MediaRequestStatus): boolean =>
  status !== MediaRequestStatus.DECLINED &&
  status !== MediaRequestStatus.FAILED &&
  status !== MediaRequestStatus.COMPLETED;

export const getCollectionPartRequestPresentation = (
  part: CollectionRequestStatePart,
  is4k: boolean
): CollectionPartRequestPresentation => {
  const status = part.mediaInfo?.[is4k ? 'status4k' : 'status'];
  if (status === MediaStatus.BLOCKLISTED) {
    return 'blocklisted';
  }
  if (status === MediaStatus.AVAILABLE) {
    return 'available';
  }
  if (
    status === MediaStatus.PROCESSING ||
    part.mediaInfo?.requests?.some(
      (request) => request.is4k === is4k && isActiveRequest(request.status)
    )
  ) {
    return 'requested';
  }
  return 'ready';
};

export const getCoveredCollectionPartIds = (
  parts: readonly CollectionRequestStatePart[],
  is4k: boolean
): number[] => {
  const covered = new Set<number>();

  for (const part of parts) {
    if (
      part.mediaInfo?.requests?.some(
        (request) => request.is4k === is4k && isActiveRequest(request.status)
      )
    ) {
      covered.add(part.id);
    }

    const status = part.mediaInfo?.[is4k ? 'status4k' : 'status'];
    if (status === MediaStatus.AVAILABLE || status === MediaStatus.PROCESSING) {
      covered.add(part.id);
    }
  }

  return [...covered];
};
