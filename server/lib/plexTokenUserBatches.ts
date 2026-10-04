import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';

export const PLEX_TOKEN_USER_BATCH_SIZE = 250;

export type PlexTokenUserBatchLoader = (
  afterId: number,
  limit: number
) => Promise<User[]>;

const loadPlexTokenUserBatch: PlexTokenUserBatchLoader = (afterId, limit) =>
  getRepository(User)
    .createQueryBuilder('user')
    .select('user.id')
    .where("user.plexToken != ''")
    .andWhere('user.id > :afterId', { afterId })
    .orderBy('user.id', 'ASC')
    .take(limit)
    .getMany();

export const forEachPlexTokenUser = async (
  callback: (user: User) => Promise<void>,
  loadBatch: PlexTokenUserBatchLoader = loadPlexTokenUserBatch
): Promise<void> => {
  let afterId = 0;

  while (true) {
    const users = (await loadBatch(afterId, PLEX_TOKEN_USER_BATCH_SIZE))
      .filter((user) => Number.isSafeInteger(user.id) && user.id > afterId)
      .sort((left, right) => left.id - right.id)
      .slice(0, PLEX_TOKEN_USER_BATCH_SIZE);

    if (users.length === 0) {
      return;
    }

    for (const user of users) {
      await callback(user);
    }

    afterId = users[users.length - 1].id;
    if (users.length < PLEX_TOKEN_USER_BATCH_SIZE) {
      return;
    }
  }
};
