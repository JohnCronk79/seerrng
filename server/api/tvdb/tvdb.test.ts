import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  TmdbSeasonWithEpisodes,
  TmdbTvEpisodeResult,
} from '@server/api/themoviedb/interfaces';
import Tvdb, { hasTvdbSeasonTranslation } from '@server/api/tvdb';
import type {
  TvdbEpisode,
  TvdbSeasonDetails,
} from '@server/api/tvdb/interfaces';

const episode = {
  id: 1,
  seasonNumber: 7,
  number: 1,
  name: 'Episode one',
} as TvdbEpisode;

const season = {
  id: 99,
  firstAired: '2026-01-01',
  episodes: [episode],
} as TvdbSeasonDetails;

type TvdbSeasonInternals = {
  getSeasonWithTranslation: (
    tvdbId: number,
    tvId: number,
    seasonNumber: number,
    season: TvdbSeasonDetails,
    language: string
  ) => Promise<TmdbSeasonWithEpisodes>;
  getSeasonWithOriginalLanguage: (
    tvdbId: number,
    tvId: number,
    seasonNumber: number,
    season: TvdbSeasonDetails
  ) => Promise<TmdbSeasonWithEpisodes>;
};

describe('TVDB season translation selection', () => {
  it('falls back when the requested and default translations are absent', () => {
    assert.strictEqual(hasTvdbSeasonTranslation([], 'fra', 'eng'), false);
    assert.strictEqual(
      hasTvdbSeasonTranslation(['spa', 'deu'], 'fra', 'eng'),
      false
    );
  });

  it('accepts either the requested or default translation', () => {
    assert.strictEqual(hasTvdbSeasonTranslation(['fra'], 'fra', 'eng'), true);
    assert.strictEqual(hasTvdbSeasonTranslation(['eng'], 'fra', 'eng'), true);
  });
});

describe('TVDB season response bounds', () => {
  it('stops translated pagination when the provider repeats a page', async () => {
    const tvdb = new Tvdb();
    let calls = 0;
    Object.defineProperty(tvdb, 'get', {
      configurable: true,
      value: async () => {
        calls += 1;
        return {
          data: { ...season, episodes: [episode] },
          links: { next: 'same-page' },
        };
      },
    });

    const response = await (
      tvdb as unknown as TvdbSeasonInternals
    ).getSeasonWithTranslation(12, 34, 7, season, 'fra');

    assert.strictEqual(calls, 2);
    assert.strictEqual(response.episodes.length, 1);
    assert.strictEqual(response.season_number, 7);
  });

  it('reports the requested season number for original-language data', async () => {
    const tvdb = new Tvdb();
    Object.defineProperty(tvdb, 'get', {
      configurable: true,
      value: async () => ({ data: season }),
    });

    const response = await (
      tvdb as unknown as TvdbSeasonInternals
    ).getSeasonWithOriginalLanguage(12, 34, 7, season);

    assert.strictEqual(response.season_number, 7);
    assert.deepStrictEqual(
      response.episodes.map(
        (result: TmdbTvEpisodeResult) => result.episode_number
      ),
      [1]
    );
  });
});
