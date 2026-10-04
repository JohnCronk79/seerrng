import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeRtHits } from './rottentomatoes';

describe('Rotten Tomatoes response normalization', () => {
  it('caps hits and nested titles while dropping malformed records', () => {
    const hits = sanitizeRtHits([
      null,
      { title: {} },
      ...Array.from({ length: 30 }, (_, index) => ({
        title: `Title ${index}`,
        titles: Array.from({ length: 40 }, () => 'Alternate'),
        aka: Array.from({ length: 40 }, () => 'AKA'),
        releaseYear: 2020,
        vanity: '../unsafe?value',
        rottenTomatoes: {
          criticsScore: 1000,
          audienceScore: -10,
          certifiedFresh: 'yes',
        },
        providerOnly: true,
      })),
    ]);

    assert.strictEqual(hits.length, 18);
    assert.strictEqual(hits[0].titles?.length, 20);
    assert.strictEqual(hits[0].aka?.length, 20);
    assert.strictEqual(hits[0].rottenTomatoes?.criticsScore, 100);
    assert.strictEqual(hits[0].rottenTomatoes?.audienceScore, 0);
    assert.strictEqual(hits[0].rottenTomatoes?.certifiedFresh, false);
    assert.ok(!('providerOnly' in hits[0]));
  });
});
