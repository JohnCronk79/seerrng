import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_MUSICBRAINZ_BATCH_IDS } from '@server/lib/externalIds';
import {
  prepareArtistMappingBatch,
  preparePersonSearchResults,
} from './personMapper';

describe('prepareArtistMappingBatch', () => {
  it('bounds and deduplicates untrusted mapping work', () => {
    const artists = prepareArtistMappingBatch([
      { artistId: ' ABC ', artistName: 'First' },
      { artistId: 'abc', artistName: 'Duplicate' },
      { artistId: 'bad', artistName: 'x'.repeat(513) },
      ...Array.from({ length: MAX_MUSICBRAINZ_BATCH_IDS + 10 }, (_, index) => ({
        artistId: `id-${index}`,
        artistName: `Artist ${index}`,
      })),
    ]);

    assert.deepStrictEqual(artists[0], {
      artistId: 'abc',
      artistName: 'First',
    });
    assert.strictEqual(artists.length, MAX_MUSICBRAINZ_BATCH_IDS);
  });
});

describe('preparePersonSearchResults', () => {
  it('bounds provider results and drops malformed people', () => {
    const people = preparePersonSearchResults({
      results: [
        null,
        { id: 1, name: {} },
        ...Array.from({ length: 150 }, (_, index) => ({
          id: index + 2,
          name: `Person ${index}`,
          popularity: Infinity,
          profile_path: 'x'.repeat(3000),
          providerOnly: true,
        })),
      ],
    });

    assert.strictEqual(people.length, 98);
    assert.strictEqual(people[0].popularity, 0);
    assert.strictEqual(people[0].profile_path?.length, 2000);
    assert.ok(!('providerOnly' in people[0]));
  });
});
