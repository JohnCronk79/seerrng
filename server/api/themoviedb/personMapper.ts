import ExternalAPI from '@server/api/externalapi';
import TheMovieDb, {
  MAX_TMDB_PAGE_RESULTS,
  sanitizeTmdbPagedResponse,
} from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import {
  MAX_MUSICBRAINZ_BATCH_IDS,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import logger from '@server/logger';
import { In } from 'typeorm';
import { getTmdbAuthHeaders, getTmdbAuthParams } from './auth';
import type { TmdbSearchPersonResponse } from './interfaces';

interface SearchPersonOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

export const prepareArtistMappingBatch = (
  value: unknown
): { artistId: string; artistName: string }[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const artists = new Map<string, string>();
  for (const rawArtist of value) {
    if (!rawArtist || typeof rawArtist !== 'object') {
      continue;
    }
    const { artistId, artistName } = rawArtist as {
      artistId?: unknown;
      artistName?: unknown;
    };
    if (
      typeof artistId !== 'string' ||
      artistId.length > 128 ||
      typeof artistName !== 'string' ||
      artistName.length > 512
    ) {
      continue;
    }
    const normalizedId = normalizeMusicBrainzId(artistId);
    const normalizedName = artistName.trim();
    if (normalizedId && normalizedName && !artists.has(normalizedId)) {
      artists.set(normalizedId, normalizedName);
    }
    if (artists.size >= MAX_MUSICBRAINZ_BATCH_IDS) {
      break;
    }
  }

  return [...artists].map(([artistId, artistName]) => ({
    artistId,
    artistName,
  }));
};

export const preparePersonSearchResults = (
  value: unknown
): TmdbSearchPersonResponse['results'] => {
  const response = sanitizeTmdbPagedResponse<TmdbSearchPersonResponse>(value);

  return response.results
    .slice(0, MAX_TMDB_PAGE_RESULTS)
    .flatMap((rawPerson) => {
      if (!rawPerson || typeof rawPerson !== 'object') {
        return [];
      }
      const person = rawPerson as unknown as Record<string, unknown>;
      const name =
        typeof person.name === 'string' ? person.name.slice(0, 512) : '';
      if (!name.trim() || !Number.isSafeInteger(person.id)) {
        return [];
      }

      return [
        {
          id: person.id as number,
          known_for_department:
            typeof person.known_for_department === 'string'
              ? person.known_for_department.slice(0, 128)
              : undefined,
          name,
          popularity:
            typeof person.popularity === 'number' &&
            Number.isFinite(person.popularity)
              ? person.popularity
              : 0,
          profile_path:
            typeof person.profile_path === 'string'
              ? person.profile_path.slice(0, 2000)
              : undefined,
          adult: person.adult === true,
          media_type: 'person' as const,
          known_for: [],
        },
      ];
    });
};

class TmdbPersonMapper extends ExternalAPI {
  private readonly CACHE_TTL = 43200;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;
  private tmdb: TheMovieDb;

  constructor() {
    super('https://api.themoviedb.org/3', getTmdbAuthParams(), {
      headers: getTmdbAuthHeaders(),
      nodeCache: cacheManager.getCache('tmdb').data,
      rateLimit: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
    this.tmdb = new TheMovieDb();
  }

  private isMetadataStale(metadata: MetadataArtist | null): boolean {
    if (!metadata || !metadata.tmdbUpdatedAt) return true;
    return Date.now() - metadata.tmdbUpdatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse() {
    return { personId: null, profilePath: null };
  }

  public async getMappingFromCache(
    artistId: string
  ): Promise<{ personId: number | null; profilePath: string | null } | null> {
    const normalizedArtistId = normalizeMusicBrainzId(artistId);

    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: normalizedArtistId },
        select: { tmdbPersonId: true, tmdbThumb: true, tmdbUpdatedAt: true },
      });

      if (!metadata) {
        return null;
      }

      if (this.isMetadataStale(metadata)) {
        return null;
      }

      return {
        personId: metadata.tmdbPersonId ? Number(metadata.tmdbPersonId) : null,
        profilePath: metadata.tmdbThumb,
      };
    } catch (error) {
      logger.error('Failed to get person mapping from cache', {
        label: 'TmdbPersonMapper',
        artistId: normalizedArtistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  public async getMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    const normalizedArtistId = normalizeMusicBrainzId(artistId);

    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: normalizedArtistId },
        select: { tmdbPersonId: true, tmdbThumb: true, tmdbUpdatedAt: true },
      });

      if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
        return {
          personId: metadata.tmdbPersonId
            ? Number(metadata.tmdbPersonId)
            : null,
          profilePath: metadata.tmdbThumb,
        };
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse();
      }

      return await this.fetchMapping(normalizedArtistId, artistName);
    } catch (error) {
      logger.error('Failed to get person mapping', {
        label: 'TmdbPersonMapper',
        artistId: normalizedArtistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse();
    }
  }

  private async fetchMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    const normalizedArtistId = normalizeMusicBrainzId(artistId);

    try {
      const existingMetadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: normalizedArtistId },
        select: { tmdbPersonId: true, tmdbThumb: true, tmdbUpdatedAt: true },
      });

      if (existingMetadata?.tmdbPersonId) {
        return {
          personId: Number(existingMetadata.tmdbPersonId),
          profilePath: existingMetadata.tmdbThumb,
        };
      }

      const cleanArtistName = artistName
        .slice(0, 512)
        .split(/(?:(?:feat|ft)\.?\s+|&\s*|,\s+)/i)[0]
        .trim()
        .replace(/['′]/g, "'");

      const searchResults = preparePersonSearchResults(
        await this.get<TmdbSearchPersonResponse>(
          '/search/person',
          {
            params: {
              query: cleanArtistName,
              page: '1',
              include_adult: 'false',
              language: 'en',
            },
          },
          this.CACHE_TTL
        )
      );

      const normalizeName = (name: string): string => {
        return name
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/['′]/g, "'")
          .replace(/[^a-z0-9\s]/g, '')
          .trim();
      };

      const exactMatches = searchResults.filter((person) => {
        const normalizedPersonName = normalizeName(person.name);
        const normalizedArtistName = normalizeName(cleanArtistName);

        return normalizedPersonName === normalizedArtistName;
      });

      if (exactMatches.length > 0) {
        const tmdbPersonIds = exactMatches.map((match) => match.id.toString());
        const existingMappings = await getRepository(MetadataArtist).find({
          where: { tmdbPersonId: In(tmdbPersonIds) },
          select: { mbArtistId: true, tmdbPersonId: true },
        });

        const availableMatches = exactMatches.filter(
          (match) =>
            !existingMappings.some(
              (mapping) =>
                mapping.tmdbPersonId === match.id.toString() &&
                normalizeMusicBrainzId(mapping.mbArtistId) !==
                  normalizedArtistId
            )
        );

        const soundMatches = availableMatches.filter(
          (person) => person.known_for_department === 'Sound'
        );

        const exactMatch =
          soundMatches.length > 0
            ? soundMatches.reduce((prev, current) =>
                current.popularity > prev.popularity ? current : prev
              )
            : availableMatches.length > 0
              ? availableMatches.reduce((prev, current) =>
                  current.popularity > prev.popularity ? current : prev
                )
              : null;

        const mapping = {
          personId: exactMatch?.id ?? null,
          profilePath: exactMatch?.profile_path
            ? `https://image.tmdb.org/t/p/w500${exactMatch.profile_path}`
            : null,
        };

        await getRepository(MetadataArtist)
          .upsert(
            {
              mbArtistId: normalizedArtistId,
              tmdbPersonId: mapping.personId?.toString() ?? null,
              tmdbThumb: mapping.profilePath,
              tmdbUpdatedAt: new Date(),
            },
            {
              conflictPaths: ['mbArtistId'],
            }
          )
          .catch((e) => {
            logger.error('Failed to save artist metadata', {
              label: 'TmdbPersonMapper',
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          });

        return mapping;
      } else {
        await getRepository(MetadataArtist).upsert(
          {
            mbArtistId: normalizedArtistId,
            tmdbPersonId: null,
            tmdbThumb: null,
            tmdbUpdatedAt: new Date(),
          },
          {
            conflictPaths: ['mbArtistId'],
          }
        );
        return this.createEmptyResponse();
      }
    } catch {
      await getRepository(MetadataArtist).upsert(
        {
          mbArtistId: normalizedArtistId,
          tmdbPersonId: null,
          tmdbThumb: null,
          tmdbUpdatedAt: new Date(),
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return this.createEmptyResponse();
    }
  }

  public async batchGetMappings(
    artists: { artistId: string; artistName: string }[]
  ): Promise<
    Record<string, { personId: number | null; profilePath: string | null }>
  > {
    if (!artists.length) return {};

    const metadataRepository = getRepository(MetadataArtist);
    const normalizedArtists = prepareArtistMappingBatch(artists);
    if (!normalizedArtists.length) return {};
    const artistIds = normalizedArtists.map((artist) => artist.artistId);

    const existingMetadata = await metadataRepository.find({
      where: { mbArtistId: In(artistIds) },
      select: {
        mbArtistId: true,
        tmdbPersonId: true,
        tmdbThumb: true,
        tmdbUpdatedAt: true,
      },
    });

    const results: Record<
      string,
      { personId: number | null; profilePath: string | null }
    > = {};
    const artistsToFetch: { artistId: string; artistName: string }[] = [];

    normalizedArtists.forEach(({ artistId, artistName }) => {
      const metadata = existingMetadata.find(
        (m) => normalizeMusicBrainzId(m.mbArtistId) === artistId
      );

      if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
        results[artistId] = {
          personId: metadata.tmdbPersonId
            ? Number(metadata.tmdbPersonId)
            : null,
          profilePath: metadata.tmdbThumb,
        };
      } else if (metadata && !this.isMetadataStale(metadata)) {
        results[artistId] = this.createEmptyResponse();
      } else {
        artistsToFetch.push({ artistId, artistName });
      }
    });

    if (artistsToFetch.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < artistsToFetch.length; i += batchSize) {
        const batch = artistsToFetch.slice(i, i + batchSize);
        const batchPromises = batch.map(({ artistId, artistName }) =>
          this.fetchMapping(artistId, artistName)
            .then((mapping) => {
              results[artistId] = mapping;
              return true;
            })
            .catch(() => {
              results[artistId] = this.createEmptyResponse();
              return false;
            })
        );

        await Promise.all(batchPromises);
      }
    }

    return results;
  }

  public async searchPerson(
    options: SearchPersonOptions
  ): Promise<TmdbSearchPersonResponse> {
    try {
      return await this.get<TmdbSearchPersonResponse>(
        '/search/person',
        {
          params: {
            query: options.query,
            page: options.page?.toString() ?? '1',
            include_adult: options.includeAdult ? 'true' : 'false',
            language: options.language ?? 'en',
          },
        },
        this.CACHE_TTL
      );
    } catch {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  }
}

export default TmdbPersonMapper;
