import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { rankByQualityScore } from './tmdbRank';

afterEach(() => {
  mock.restoreAll();
});

describe('rankByQualityScore', () => {
  it('allows close quality scores to move between refreshes', () => {
    const jitterValues = [0, 1];
    mock.method(Math, 'random', () => jitterValues.shift() ?? 0);

    const ranked = rankByQualityScore(
      [
        { title: 'A', score: 100 },
        { title: 'B', score: 99 },
      ],
      (item) => item.score
    );

    assert.deepStrictEqual(
      ranked.map((item) => item.title),
      ['B', 'A']
    );
  });

  it('keeps weak candidates below substantially stronger candidates', () => {
    mock.method(Math, 'random', () => 1);

    const ranked = rankByQualityScore(
      [
        { title: 'Strong', score: 100 },
        { title: 'Weak', score: 20 },
      ],
      (item) => item.score
    );

    assert.deepStrictEqual(
      ranked.map((item) => item.title),
      ['Strong', 'Weak']
    );
  });

  it('returns a stable order for the same seed', () => {
    const items = [
      { title: 'A', score: 100 },
      { title: 'B', score: 99 },
      { title: 'C', score: 98 },
    ];

    const firstRank = rankByQualityScore(
      items,
      (item) => item.score,
      undefined,
      undefined,
      'refresh-a'
    );
    const secondRank = rankByQualityScore(
      items,
      (item) => item.score,
      undefined,
      undefined,
      'refresh-a'
    );

    assert.deepStrictEqual(firstRank, secondRank);
  });

  it('allows seeded discovery callers to request stronger visible jitter', () => {
    const items = [
      { title: 'A', score: 100 },
      { title: 'B', score: 99 },
      { title: 'C', score: 98 },
      { title: 'D', score: 97 },
      { title: 'E', score: 96 },
    ];

    const firstRank = rankByQualityScore(
      items,
      (item) => item.score,
      0.75,
      50,
      'refresh-a'
    );
    const secondRank = rankByQualityScore(
      items,
      (item) => item.score,
      0.75,
      50,
      'refresh-b'
    );

    assert.notDeepStrictEqual(
      firstRank.map((item) => item.title),
      secondRank.map((item) => item.title)
    );
  });
});
