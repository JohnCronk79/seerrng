import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import {
  MAX_MUSICBRAINZ_BATCH_IDS,
  isValidExternalMediaId,
  normalizeExternalMediaId,
  prepareMusicBrainzBatchIds,
} from './externalIds';

describe('prepareMusicBrainzBatchIds', () => {
  it('normalizes, deduplicates, validates, and caps SQL-bound IDs', () => {
    const ids = prepareMusicBrainzBatchIds([
      ' ABC ',
      'abc',
      123,
      'x'.repeat(129),
      '../search',
      'album?redirect=/account',
      ...Array.from(
        { length: MAX_MUSICBRAINZ_BATCH_IDS + 10 },
        (_, index) => `id-${index}`
      ),
    ]);

    assert.strictEqual(ids[0], 'abc');
    assert.ok(!ids.includes('../search'));
    assert.strictEqual(ids.length, MAX_MUSICBRAINZ_BATCH_IDS);
    assert.deepStrictEqual(prepareMusicBrainzBatchIds({}), []);
  });
});

describe('comic external id validation', () => {
  it('accepts a plain ComicVine numeric id with no provider or an explicit COMICVINE provider', () => {
    assert.strictEqual(isValidExternalMediaId('12345', MediaType.COMIC), true);
    assert.strictEqual(
      isValidExternalMediaId(
        '12345',
        MediaType.COMIC,
        MediaIdentifierProvider.COMICVINE
      ),
      true
    );
  });

  it('rejects a non-numeric id or an unrelated provider', () => {
    assert.strictEqual(isValidExternalMediaId('abc', MediaType.COMIC), false);
    assert.strictEqual(
      isValidExternalMediaId(
        '12345',
        MediaType.COMIC,
        MediaIdentifierProvider.OPENLIBRARY
      ),
      false
    );
  });

  it('passes a comic id through unchanged', () => {
    assert.strictEqual(
      normalizeExternalMediaId(' 12345 ', MediaType.COMIC),
      '12345'
    );
  });
});
