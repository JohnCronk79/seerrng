import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { MoreThan } from 'typeorm';

export const NOTIFICATION_USER_BATCH_SIZE = 250;

export type NotificationUserBatchLoader = (
  afterId: number,
  limit: number
) => Promise<User[]>;

const loadNotificationUserBatch: NotificationUserBatchLoader = (
  afterId,
  limit
) =>
  getRepository(User).find({
    where: { id: MoreThan(afterId) },
    order: { id: 'ASC' },
    take: limit,
  });

export const forEachNotificationUserBatch = async (
  callback: (users: User[]) => Promise<boolean | void>,
  loadBatch: NotificationUserBatchLoader = loadNotificationUserBatch
): Promise<void> => {
  let afterId = 0;

  while (true) {
    const users = (await loadBatch(afterId, NOTIFICATION_USER_BATCH_SIZE))
      .filter((user) => Number.isSafeInteger(user.id) && user.id > afterId)
      .sort((left, right) => left.id - right.id)
      .slice(0, NOTIFICATION_USER_BATCH_SIZE);

    if (users.length === 0) {
      return;
    }

    if ((await callback(users)) === false) {
      return;
    }
    afterId = users[users.length - 1].id;

    if (users.length < NOTIFICATION_USER_BATCH_SIZE) {
      return;
    }
  }
};
