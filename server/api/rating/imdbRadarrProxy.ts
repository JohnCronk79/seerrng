import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export interface IMDBRating {
  title: string;
  url: string;
  criticsScore: number;
  criticsScoreCount: number;
}

const IMDB_ID_PATTERN = /^tt[0-9]{1,20}$/;

export const sanitizeImdbRatingResponse = (
  value: unknown,
  imdbId: string
): IMDBRating | null => {
  if (!IMDB_ID_PATTERN.test(imdbId) || !Array.isArray(value)) {
    return null;
  }
  const movie = value[0];
  if (!movie || typeof movie !== 'object') {
    return null;
  }
  const record = movie as Record<string, unknown>;
  const movieRatings = record.MovieRatings;
  if (
    record.ImdbId !== imdbId ||
    typeof record.Title !== 'string' ||
    !movieRatings ||
    typeof movieRatings !== 'object'
  ) {
    return null;
  }
  const imdb = (movieRatings as Record<string, unknown>).Imdb;
  if (!imdb || typeof imdb !== 'object') {
    return null;
  }
  const rating = imdb as Record<string, unknown>;
  if (
    typeof rating.Value !== 'number' ||
    !Number.isFinite(rating.Value) ||
    typeof rating.Count !== 'number' ||
    !Number.isSafeInteger(rating.Count) ||
    rating.Count < 0
  ) {
    return null;
  }

  return {
    title: record.Title.slice(0, 500),
    url: `https://www.imdb.com/title/${imdbId}`,
    criticsScore: Math.min(10, Math.max(0, rating.Value)),
    criticsScoreCount: rating.Count,
  };
};

/**
 * This is a best-effort API. The IMDB API is technically
 * private and getting access costs money/requires approval.
 *
 * Radarr hosts a public proxy that's in use by all Radarr instances.
 */
class IMDBRadarrProxy extends ExternalAPI {
  constructor() {
    super(
      'https://api.radarr.video/v1',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('imdb').data,
      }
    );
  }

  /**
   * Ask the Radarr IMDB Proxy for the movie
   *
   * @param IMDBid Id of IMDB movie
   */
  public async getMovieRatings(IMDBid: string): Promise<IMDBRating | null> {
    if (!IMDB_ID_PATTERN.test(IMDBid)) {
      return null;
    }

    try {
      const data = await this.get<unknown>(`/movie/imdb/${IMDBid}`);

      return sanitizeImdbRatingResponse(data, IMDBid);
    } catch (e) {
      throw new Error(
        `[IMDB RADARR PROXY API] Failed to retrieve movie ratings: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default IMDBRadarrProxy;
