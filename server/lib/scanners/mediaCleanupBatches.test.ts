import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import {
  MEDIA_CLEANUP_BATCH_SIZE,
  forEachMediaCleanupBatch,
} from './mediaCleanupBatches';

describe('forEachMediaCleanupBatch', () => {
  it('uses a fixed-size keyset snapshot and excludes later rows', async () => {
    const source = Array.from(
      { length: MEDIA_CLEANUP_BATCH_SIZE + 2 },
      (_, index) => new Media({ id: index + 1 })
    );
    const visited: number[] = [];
    const afterIds: number[] = [];

    await forEachMediaCleanupBatch(
      { mediaType: MediaType.MOVIE },
      async (media) => {
        visited.push(media.id);
      },
      {
        loadMaxId: async () => source[source.length - 1].id,
        loadBatch: async (afterId, maxId, limit) => {
          afterIds.push(afterId);
          source.push(new Media({ id: source.length + 1 }));
          return source
            .filter((media) => media.id > afterId && media.id <= maxId)
            .slice(0, limit);
        },
      }
    );

    assert.deepStrictEqual(afterIds, [0, MEDIA_CLEANUP_BATCH_SIZE]);
    assert.equal(visited.length, MEDIA_CLEANUP_BATCH_SIZE + 2);
    assert.equal(visited.at(-1), MEDIA_CLEANUP_BATCH_SIZE + 2);
  });
});
