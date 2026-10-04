import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import jaro from 'wink-jaro-distance';

interface RTAlgoliaSearchResponse {
  results: {
    hits: RTAlgoliaHit[];
    index: 'content_rt' | 'people_rt';
  }[];
}

interface RTAlgoliaHit {
  emsId: string;
  emsVersionId: string;
  tmsId: string;
  type: string;
  title: string;
  titles?: string[];
  description: string;
  releaseYear: number;
  rating: string;
  genres: string[];
  updateDate: string;
  isEmsSearchable: boolean;
  rtId: number;
  vanity: string;
  aka?: string[];
  posterImageUrl: string;
  rottenTomatoes?: {
    audienceScore: number;
    criticsIconUrl: string;
    wantToSeeCount: number;
    audienceIconUrl: string;
    scoreSentiment: string;
    certifiedFresh: boolean;
    criticsScore: number;
  };
}

export interface RTRating {
  title: string;
  year: number;
  criticsRating: 'Certified Fresh' | 'Fresh' | 'Rotten';
  criticsScore: number;
  audienceRating?: 'Upright' | 'Spilled';
  audienceScore?: number;
  url: string;
}

// Tunables
const INEXACT_TITLE_FACTOR = 0.25;
const ALTERNATE_TITLE_FACTOR = 0.8;
const PER_YEAR_PENALTY = 0.4;
const MINIMUM_SCORE = 0.175;
const MAX_RT_RESULTS = 20;
const MAX_RT_ALTERNATE_TITLES = 20;
const MAX_RT_TITLE_LENGTH = 500;
const RT_CACHE_TTL = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedTitles = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .slice(0, MAX_RT_ALTERNATE_TITLES)
    .filter((title): title is string => typeof title === 'string')
    .map((title) => title.slice(0, MAX_RT_TITLE_LENGTH));
};

export const sanitizeRtHits = (value: unknown): RTAlgoliaHit[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_RT_RESULTS)
    .flatMap((rawHit) => {
      if (!isRecord(rawHit) || typeof rawHit.title !== 'string') {
        return [];
      }
      const rottenTomatoes = isRecord(rawHit.rottenTomatoes)
        ? rawHit.rottenTomatoes
        : undefined;
      const numericScore = (score: unknown): number =>
        typeof score === 'number' && Number.isFinite(score)
          ? Math.min(100, Math.max(0, score))
          : 0;

      return [
        {
          emsId: '',
          emsVersionId: '',
          tmsId: '',
          type: typeof rawHit.type === 'string' ? rawHit.type.slice(0, 64) : '',
          title: rawHit.title.slice(0, MAX_RT_TITLE_LENGTH),
          titles: boundedTitles(rawHit.titles),
          description: '',
          releaseYear:
            typeof rawHit.releaseYear === 'number' &&
            Number.isFinite(rawHit.releaseYear)
              ? Math.trunc(rawHit.releaseYear)
              : 0,
          rating: '',
          genres: [],
          updateDate: '',
          isEmsSearchable: rawHit.isEmsSearchable === true,
          rtId: 0,
          vanity:
            typeof rawHit.vanity === 'string'
              ? rawHit.vanity.slice(0, 200)
              : '',
          aka: boundedTitles(rawHit.aka),
          posterImageUrl: '',
          rottenTomatoes: rottenTomatoes
            ? {
                audienceScore: numericScore(rottenTomatoes.audienceScore),
                criticsIconUrl: '',
                wantToSeeCount: 0,
                audienceIconUrl: '',
                scoreSentiment: '',
                certifiedFresh: rottenTomatoes.certifiedFresh === true,
                criticsScore: numericScore(rottenTomatoes.criticsScore),
              }
            : undefined,
        },
      ];
    });

const getContentHits = (value: unknown): RTAlgoliaHit[] => {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }
  const content = value.results
    .slice(0, 10)
    .find((result) => isRecord(result) && result.index === 'content_rt');
  return isRecord(content) ? sanitizeRtHits(content.hits) : [];
};

// Normalization for title comparisons.
// Lowercase and strip non-alphanumeric (unicode-aware).
const norm = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');

// Title similarity. 1 if exact, quarter-jaro otherwise.
const similarity = (a: string, b: string): number =>
  a === b ? 1 : jaro(a, b).similarity * INEXACT_TITLE_FACTOR;

// Gets the best similarity score between the searched title and all alternate
// titles of the search result. Non-main titles are penalized.
const t_score = ({ title, titles, aka }: RTAlgoliaHit, s: string): number => {
  const f = (t: string, i: number) =>
    similarity(norm(t), norm(s)) * (i ? ALTERNATE_TITLE_FACTOR : 1);
  return Math.max(...[title].concat(aka || [], titles || []).map(f));
};

// Year difference to score: 0 -> 1.0, 1 -> 0.6, 2 -> 0.2, 3+ -> 0.0
const y_score = (r: RTAlgoliaHit, y?: number): number =>
  y ? Math.max(0, 1 - Math.abs(r.releaseYear - y) * PER_YEAR_PENALTY) : 1;

// Cut score in half if result has no ratings.
const extra_score = (r: RTAlgoliaHit): number => (r.rottenTomatoes ? 1 : 0.5);

// Score search result as product of all subscores
const score = (r: RTAlgoliaHit, name: string, year?: number): number =>
  t_score(r, name) * y_score(r, year) * extra_score(r);

// Score each search result and return the highest scoring result, if any
const best = (rs: RTAlgoliaHit[], name: string, year?: number): RTAlgoliaHit =>
  rs
    .map((r) => ({ score: score(r, name, year), result: r }))
    .filter(({ score }) => score > MINIMUM_SCORE)
    .sort(({ score: a }, { score: b }) => b - a)[0]?.result;

/**
 * This is a best-effort API. The Rotten Tomatoes API is technically
 * private and getting access costs money/requires approval.
 *
 * They do, however, have a "public" api that they use to request the
 * data on their own site. We use this to get ratings for movies/tv shows.
 *
 * Unfortunately, we need to do it by searching for the movie name, so it's
 * not always accurate.
 */
class RottenTomatoes extends ExternalAPI {
  constructor() {
    const settings = getSettings();
    super(
      'https://79frdp12pn-dsn.algolia.net/1/indexes/*',
      {
        'x-algolia-agent':
          'Algolia%20for%20JavaScript%20(4.14.3)%3B%20Browser%20(lite)',
        'x-algolia-api-key': '175588f6e5f8319b27702e4cc4013561',
        'x-algolia-application-id': '79FRDP12PN',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-algolia-usertoken': settings.clientId,
        },
        nodeCache: cacheManager.getCache('rt').data,
      }
    );
  }

  /**
   * Search the RT algolia api for the movie title
   *
   * We compare the release date to make sure its the correct
   * match. But it's not guaranteed to have results.
   *
   * @param name Movie name
   * @param year Release Year
   */
  public async getMovieRatings(
    name: string,
    year: number
  ): Promise<RTRating | null> {
    try {
      const filters = encodeURIComponent('isEmsSearchable=1 AND type:"movie"');
      const data = await this.post<RTAlgoliaSearchResponse>(
        '/queries',
        {
          requests: [
            {
              indexName: 'content_rt',
              query: name
                .slice(0, MAX_RT_TITLE_LENGTH)
                .replace(/\bthe\b ?/gi, ''),
              params: `filters=${filters}&hitsPerPage=20`,
            },
          ],
        },
        undefined,
        RT_CACHE_TTL
      );

      const movie = best(
        getContentHits(data),
        name.slice(0, MAX_RT_TITLE_LENGTH),
        year
      );

      if (!movie?.rottenTomatoes) return null;

      return {
        title: movie.title,
        url: `https://www.rottentomatoes.com/m/${encodeURIComponent(
          movie.vanity
        )}`,
        criticsRating: movie.rottenTomatoes.certifiedFresh
          ? 'Certified Fresh'
          : movie.rottenTomatoes.criticsScore >= 60
            ? 'Fresh'
            : 'Rotten',
        criticsScore: movie.rottenTomatoes.criticsScore,
        audienceRating:
          movie.rottenTomatoes.audienceScore >= 60 ? 'Upright' : 'Spilled',
        audienceScore: movie.rottenTomatoes.audienceScore,
        year: Number(movie.releaseYear),
      };
    } catch (e) {
      throw new Error(
        `[RT API] Failed to retrieve movie ratings: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getTVRatings(
    name: string,
    year?: number
  ): Promise<RTRating | null> {
    try {
      const filters = encodeURIComponent('isEmsSearchable=1 AND type:"tv"');
      const data = await this.post<RTAlgoliaSearchResponse>(
        '/queries',
        {
          requests: [
            {
              indexName: 'content_rt',
              query: name.slice(0, MAX_RT_TITLE_LENGTH),
              params: `filters=${filters}&hitsPerPage=20`,
            },
          ],
        },
        undefined,
        RT_CACHE_TTL
      );

      const tvshow = best(
        getContentHits(data),
        name.slice(0, MAX_RT_TITLE_LENGTH),
        year
      );

      if (!tvshow?.rottenTomatoes) return null;

      return {
        title: tvshow.title,
        url: `https://www.rottentomatoes.com/tv/${encodeURIComponent(
          tvshow.vanity
        )}`,
        criticsRating:
          tvshow.rottenTomatoes.criticsScore >= 60 ? 'Fresh' : 'Rotten',
        criticsScore: tvshow.rottenTomatoes.criticsScore,
        audienceRating:
          tvshow.rottenTomatoes.audienceScore >= 60 ? 'Upright' : 'Spilled',
        audienceScore: tvshow.rottenTomatoes.audienceScore,
        year: Number(tvshow.releaseYear),
      };
    } catch (e) {
      throw new Error(`[RT API] Failed to retrieve tv ratings: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default RottenTomatoes;
