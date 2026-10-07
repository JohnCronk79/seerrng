import type {
  ComicVinePublisher,
  ComicVineSearchResponse,
  ComicVineVolumeResult,
} from '@server/api/comicvine';
import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

export const METRON_BASE_URL = 'https://metron.cloud/api';

/** Metron serializes series with these fields; see `api/v1_0/serializers/series.py`. */
interface MetronPublisher {
  id?: unknown;
  name?: unknown;
}

interface MetronSeries {
  id?: unknown;
  series?: unknown;
  year_began?: unknown;
  issue_count?: unknown;
  publisher?: unknown;
  cv_id?: unknown;
}

interface MetronSeriesListResponse {
  count?: unknown;
  results?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const boundedString = (
  value: unknown,
  maxLength = 1_000
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\r\n\0]+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
};

const sanitizePublisher = (value: unknown): ComicVinePublisher | undefined => {
  if (!isRecord(value)) return undefined;
  const publisher = value as MetronPublisher;
  const id = boundedInteger(publisher.id);
  const name = boundedString(publisher.name);
  return id !== undefined && name ? { id, name } : undefined;
};

/**
 * Metron's `__str__` for a series appends the start year, for example
 * "Batman (2016)". ComicVine volume names do not, so the year is removed
 * from the name and returned separately.
 */
export const splitMetronSeriesName = (
  display: string
): { name: string; year?: string } => {
  const match = display.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return match
    ? { name: match[1].trim() || display, year: match[2] }
    : { name: display };
};

/**
 * Maps one Metron series to the ComicVine volume shape the search route uses.
 * Only series with a ComicVine ID qualify, because SeerrNG's comic requests
 * are keyed by ComicVine volume IDs.
 */
export const mapMetronSeriesToVolume = (
  value: unknown
): ComicVineVolumeResult | undefined => {
  if (!isRecord(value)) return undefined;
  const series = value as MetronSeries;
  const comicVineId = boundedInteger(series.cv_id);
  const display = boundedString(series.series);
  if (!comicVineId || !display) return undefined;

  const { name, year } = splitMetronSeriesName(display);
  const yearBegan = boundedInteger(series.year_began);

  return {
    id: comicVineId,
    name,
    start_year: year ?? (yearBegan ? String(yearBegan) : undefined),
    count_of_issues: boundedInteger(series.issue_count),
    publisher: sanitizePublisher(series.publisher),
    resource_type: 'volume',
  };
};

class MetronAPI extends ExternalAPI {
  constructor(token: string) {
    super(
      METRON_BASE_URL,
      {},
      {
        nodeCache: cacheManager.getCache('metron').data,
        headers: { Authorization: `Bearer ${token}` },
        // Metron's documented burst limit is 20 requests per minute. Stay
        // under it; the sustained daily limit is read from response headers.
        rateLimit: {
          maxRequests: 18,
          perMilliseconds: 60_000,
        },
      }
    );
  }

  /**
   * Searches Metron series by name and returns those that map to ComicVine
   * volumes. Metron pages are server-defined, so the requested page is passed
   * through and results are capped to `limit`.
   */
  public async searchVolumes({
    query,
    page = 1,
    limit = 20,
  }: {
    query: string;
    page?: number;
    limit?: number;
  }): Promise<ComicVineSearchResponse> {
    const boundedLimit = Math.min(Math.max(1, limit), 100);
    const response = await this.get<MetronSeriesListResponse>(
      '/series/',
      { params: { name: query, page: Math.max(1, page) } },
      43200
    );

    if (!isRecord(response)) {
      throw new Error('Metron returned an invalid series response.');
    }

    const rows = Array.isArray(response.results) ? response.results : [];
    const results = rows
      .map(mapMetronSeriesToVolume)
      .filter((result): result is ComicVineVolumeResult => !!result)
      .slice(0, boundedLimit);

    return {
      error: 'OK',
      limit: boundedLimit,
      offset: (Math.max(1, page) - 1) * boundedLimit,
      number_of_page_results: results.length,
      number_of_total_results: boundedInteger(response.count) ?? results.length,
      status_code: 1,
      results,
    };
  }
}

export default MetronAPI;
