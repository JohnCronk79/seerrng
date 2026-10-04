import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { User } from '@server/entity/User';
import {
  NOTIFICATION_USER_BATCH_SIZE,
  forEachNotificationUserBatch,
} from './userBatches';

describe('notification user batching', () => {
  it('keyset-pages every user without exceeding the SQL-safe batch size', async () => {
    const source = Array.from(
      { length: NOTIFICATION_USER_BATCH_SIZE * 2 + 17 },
      (_, index) => new User({ id: index + 1 })
    );
    const seen: number[] = [];
    const batchSizes: number[] = [];

    await forEachNotificationUserBatch(
      async (users) => {
        batchSizes.push(users.length);
        seen.push(...users.map((user) => user.id));
      },
      async (afterId, limit) =>
        source.filter((user) => user.id > afterId).slice(0, limit)
    );

    assert.deepStrictEqual(
      seen,
      source.map((user) => user.id)
    );
    assert.deepStrictEqual(batchSizes, [250, 250, 17]);
  });
});
