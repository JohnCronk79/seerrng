import { User } from '@server/entity/User';
import {
  forEachPlexTokenUser,
  PLEX_TOKEN_USER_BATCH_SIZE,
} from '@server/lib/plexTokenUserBatches';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Plex token user batching', () => {
  it('processes deterministic keyset batches without retaining all users', async () => {
    const users = Array.from(
      { length: PLEX_TOKEN_USER_BATCH_SIZE + 2 },
      (_, index) => new User({ id: index + 1 })
    );
    const afterIds: number[] = [];
    const processedIds: number[] = [];

    await forEachPlexTokenUser(
      async (user) => {
        processedIds.push(user.id);
      },
      async (afterId, limit) => {
        afterIds.push(afterId);
        return users.filter((user) => user.id > afterId).slice(0, limit);
      }
    );

    assert.deepStrictEqual(afterIds, [0, PLEX_TOKEN_USER_BATCH_SIZE]);
    assert.deepStrictEqual(
      processedIds,
      users.map((user) => user.id)
    );
  });

  it('ignores invalid loader rows and sorts valid rows', async () => {
    const processedIds: number[] = [];

    await forEachPlexTokenUser(
      async (user) => {
        processedIds.push(user.id);
      },
      async () => [
        new User({ id: 0 }),
        new User({ id: 2 }),
        new User({ id: 1 }),
      ]
    );

    assert.deepStrictEqual(processedIds, [1, 2]);
  });
});
