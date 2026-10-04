import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';

export type MediaServerUserAuthorityType = 'jellyfin' | 'plex';

export interface MediaServerUserAuthoritySnapshot {
  userId: number;
  type: MediaServerUserAuthorityType;
  plexToken?: string | null;
  jellyfinUserId?: string | null;
  jellyfinDeviceId?: string | null;
}

export class MediaServerUserAuthorityChangedError extends Error {
  constructor(type: MediaServerUserAuthorityType) {
    super(`${type} user authority changed during operation.`);
    this.name = 'MediaServerUserAuthorityChangedError';
  }
}

const loadMediaServerUserAuthority = async (
  userId: number,
  type: MediaServerUserAuthorityType
): Promise<MediaServerUserAuthoritySnapshot | undefined> => {
  const user = await getRepository(User).findOne({
    where: { id: userId },
    select:
      type === 'plex'
        ? { id: true, plexToken: true }
        : {
            id: true,
            jellyfinUserId: true,
            jellyfinDeviceId: true,
          },
  });
  if (!user) return undefined;

  return type === 'plex'
    ? { userId, type, plexToken: user.plexToken }
    : {
        userId,
        type,
        jellyfinUserId: user.jellyfinUserId,
        jellyfinDeviceId: user.jellyfinDeviceId,
      };
};

export const assertMediaServerUserAuthorityCurrent = async (
  snapshot: MediaServerUserAuthoritySnapshot
): Promise<void> => {
  const current = await loadMediaServerUserAuthority(
    snapshot.userId,
    snapshot.type
  );
  const unchanged =
    snapshot.type === 'plex'
      ? current?.plexToken === snapshot.plexToken
      : current?.jellyfinUserId === snapshot.jellyfinUserId &&
        current?.jellyfinDeviceId === snapshot.jellyfinDeviceId;
  if (!unchanged) {
    throw new MediaServerUserAuthorityChangedError(snapshot.type);
  }
};

export const captureMediaServerUserAuthority = (
  userId: number,
  type: MediaServerUserAuthorityType
): Promise<MediaServerUserAuthoritySnapshot> =>
  runUserSecurityMutation(userId, async () => {
    const snapshot = await loadMediaServerUserAuthority(userId, type);
    if (!snapshot) throw new MediaServerUserAuthorityChangedError(type);
    return snapshot;
  });

export const runWithMediaServerUserAuthority = <Result>(
  snapshot: MediaServerUserAuthoritySnapshot,
  callback: () => Promise<Result>
): Promise<Result> =>
  runUserSecurityMutation(snapshot.userId, async () => {
    await assertMediaServerUserAuthorityCurrent(snapshot);
    return callback();
  });
