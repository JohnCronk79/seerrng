import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import { setupTestDb } from '@server/test/db';
import TheAudioDb, { sanitizeTheAudioDbImageUrl } from '.';

setupTestDb();

describe('TheAudioDb batch hydration', () => {
  it('bounds concurrent provider fetches', async () => {
    const api = new TheAudioDb();
    let active = 0;
    let peak = 0;
    Object.assign(api as unknown as Record<string, unknown>, {
      fetchArtistImages: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return { artistThumb: null, artistBackground: null };
      },
    });

    const result = await api.batchGetArtistImages(
      Array.from({ length: 20 }, (_, index) => `artist-${index}`)
    );

    assert.strictEqual(Object.keys(result).length, 20);
    assert.ok(peak <= TheAudioDb.BATCH_FETCH_CONCURRENCY);
    assert.strictEqual(TheAudioDb.BATCH_FETCH_CONCURRENCY, 5);
  });
});

describe('TheAudioDb transient failure handling', () => {
  afterEach(() => mock.restoreAll());

  it('does not persist a negative cache result for a transient failure', async () => {
    const artistId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => {
      throw Object.assign(new Error('timeout of 10000ms exceeded'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
      });
    });

    const result = await new TheAudioDb().getArtistImages(artistId);

    assert.deepStrictEqual(result, {
      artistThumb: null,
      artistBackground: null,
    });
    const metadata = await getRepository(MetadataArtist).findOneBy({
      mbArtistId: artistId,
    });
    assert.strictEqual(metadata, null);
  });
});

describe('sanitizeTheAudioDbImageUrl', () => {
  it('accepts only bounded HTTPS URLs on TheAudioDB hosts', () => {
    assert.strictEqual(
      sanitizeTheAudioDbImageUrl(
        'https://r2.theaudiodb.com/images/media/artist/thumb/image.jpg#fragment'
      ),
      'https://r2.theaudiodb.com/images/media/artist/thumb/image.jpg'
    );
    assert.strictEqual(
      sanitizeTheAudioDbImageUrl('https://theaudiodb.com.evil.test/image.jpg'),
      null
    );
    assert.strictEqual(
      sanitizeTheAudioDbImageUrl('http://r2.theaudiodb.com/image.jpg'),
      null
    );
    assert.strictEqual(sanitizeTheAudioDbImageUrl({}), null);
    assert.strictEqual(
      sanitizeTheAudioDbImageUrl(
        `https://r2.theaudiodb.com/${'x'.repeat(3000)}`
      ),
      null
    );
  });
});
