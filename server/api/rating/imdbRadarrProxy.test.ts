import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeImdbRatingResponse } from './imdbRadarrProxy';

describe('IMDb Radarr proxy response normalization', () => {
  it('accepts a matching bounded rating', () => {
    assert.deepStrictEqual(
      sanitizeImdbRatingResponse(
        [
          {
            ImdbId: 'tt123',
            Title: 'Movie',
            MovieRatings: { Imdb: { Value: 12, Count: 10 } },
            providerOnly: true,
          },
        ],
        'tt123'
      ),
      {
        title: 'Movie',
        url: 'https://www.imdb.com/title/tt123',
        criticsScore: 10,
        criticsScoreCount: 10,
      }
    );
  });

  it('rejects malformed identifiers and nested ratings', () => {
    assert.strictEqual(sanitizeImdbRatingResponse([], '../unsafe'), null);
    assert.strictEqual(
      sanitizeImdbRatingResponse(
        [
          {
            ImdbId: 'tt123',
            Title: 'Movie',
            MovieRatings: { Imdb: { Value: '10', Count: 10 } },
          },
        ],
        'tt123'
      ),
      null
    );
  });
});
