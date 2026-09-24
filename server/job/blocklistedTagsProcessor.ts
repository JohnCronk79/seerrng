import {
  MovieSortOptionsIterable,
  TvSortOptionsIterable,
} from '@server/api/themoviedb';
import type {
  TmdbSearchMovieResponse,
  TmdbSearchTvResponse,
} from '@server/api/themoviedb/interfaces';
import {
  MAX_BLOCKLISTED_TAG_IDS,
  MAX_BLOCKLISTED_TAG_PAGES,
  MAX_TMDB_KEYWORD_ID,
} from '@server/constants/blocklist';
import { MediaType } from '@server/constants/media';
import dataSource from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import { runWithRequestAdmission } from '@server/entity/MediaRequest';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createTmdbWithBlocklistSettings } from '@server/routes/discover';
import { IsNull, Not, type EntityManager } from 'typeorm';

const TMDB_API_DELAY_MS = 250;
export const MAX_AUTOMATIC_BLOCKLIST_ENTRIES = 10_000;
class AbortTransaction extends Error {}

type Delay = (milliseconds: number) => Promise<void>;

type DesiredBlocklistEntry = {
  mediaType: MediaType.MOVIE | MediaType.TV;
  title: string;
  tmdbId: number;
  keywordIds: Set<string>;
};

const getAdmissionKey = (mediaType: MediaType, tmdbId: number): string =>
  `request-media:${mediaType}:${tmdbId}`;

export class BlocklistedTagProcessor implements RunnableScanner<StatusBase> {
  private activeRun?: symbol;
  private progress = 0;
  private total = 0;

  public constructor(
    private readonly createTmdb = createTmdbWithBlocklistSettings,
    private readonly delay: Delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly maxEntries = MAX_AUTOMATIC_BLOCKLIST_ENTRIES
  ) {}

  public async run(): Promise<void> {
    if (this.activeRun) {
      logger.warn('Blocklisted tags processor is already running.', {
        label: 'Jobs',
      });
      return;
    }

    const runId = Symbol('blocklisted-tags-run');
    this.activeRun = runId;

    try {
      const desiredEntries = await this.collectBlocklistEntries(runId);
      this.assertEntryLimit(desiredEntries.size);
      this.assertActive(runId);
      const existingAutomatic = await dataSource.getRepository(Blocklist).find({
        where: { blocklistedTags: Not(IsNull()) },
        select: { id: true, mediaType: true, tmdbId: true },
        order: { id: 'ASC' },
        take: this.maxEntries + 1,
        loadEagerRelations: false,
      });
      this.assertEntryLimit(existingAutomatic.length);
      this.assertActive(runId);
      const admissionKeys = [
        ...desiredEntries.values(),
        ...existingAutomatic,
      ].map((entry) => getAdmissionKey(entry.mediaType, entry.tmdbId));

      await runWithRequestAdmission(admissionKeys, () =>
        dataSource.transaction(async (em) => {
          this.assertActive(runId);
          await this.reconcileBlocklistEntries(desiredEntries, em, runId);
        })
      );
    } catch (err) {
      if (err instanceof AbortTransaction) {
        logger.info('Aborting job: Process Blocklisted Tags', {
          label: 'Jobs',
        });
      } else {
        throw err;
      }
    } finally {
      this.reset(runId);
    }
  }

  public status(): StatusBase {
    return {
      running: this.activeRun !== undefined,
      progress: this.progress,
      total: this.total,
    };
  }

  public cancel() {
    this.activeRun = undefined;
    this.progress = 0;
    this.total = 0;
  }

  private reset(runId: symbol) {
    if (this.activeRun === runId) {
      this.cancel();
    }
  }

  private assertActive(runId: symbol): void {
    if (this.activeRun !== runId) {
      throw new AbortTransaction();
    }
  }

  private assertEntryLimit(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.maxEntries) {
      throw new Error(
        `Automatic blocklist exceeds the ${this.maxEntries}-entry safety limit.`
      );
    }
  }

  private async collectBlocklistEntries(
    runId: symbol
  ): Promise<Map<string, DesiredBlocklistEntry>> {
    const tmdb = this.createTmdb();
    const desiredEntries = new Map<string, DesiredBlocklistEntry>();

    const settings = getSettings();
    const blocklistedTags = settings.main.blocklistedTags;
    const configuredTags = blocklistedTags.split(',').map((tag) => tag.trim());
    const allUniqueTags = [...new Set(configuredTags)];
    const uniqueTags = allUniqueTags.slice(0, MAX_BLOCKLISTED_TAG_IDS);

    const configuredPageLimit = settings.main.blocklistedTagsLimit;
    const pageLimit = Number.isSafeInteger(configuredPageLimit)
      ? Math.min(MAX_BLOCKLISTED_TAG_PAGES, Math.max(0, configuredPageLimit))
      : 0;
    const invalidKeywords = new Set(
      allUniqueTags.slice(MAX_BLOCKLISTED_TAG_IDS)
    );
    const blocklistedTagsArr: string[] = [];
    let failedQueries = 0;

    if (blocklistedTags.length === 0) {
      return desiredEntries;
    }

    // The maximum number of queries we're expected to execute
    this.total =
      uniqueTags.length *
      pageLimit *
      (MovieSortOptionsIterable.length + TvSortOptionsIterable.length);

    for (const tag of uniqueTags) {
      this.assertActive(runId);
      if (
        !/^\d+$/.test(tag) ||
        Number(tag) < 1 ||
        Number(tag) > MAX_TMDB_KEYWORD_ID
      ) {
        invalidKeywords.add(tag);
        continue;
      }

      const keywordDetails = await tmdb.getKeywordDetails({
        keywordId: Number(tag),
      });
      if (keywordDetails === null) {
        logger.warn('Skipping invalid keyword in blocklisted tags', {
          label: 'Blocklisted Tags Processor',
          keywordId: tag,
        });
        invalidKeywords.add(tag);
        continue;
      }
      blocklistedTagsArr.push(tag);
    }

    for (const tag of blocklistedTagsArr) {
      failedQueries += await this.processTagForType(
        MediaType.MOVIE,
        tag,
        runId,
        tmdb.getDiscoverMovies,
        MovieSortOptionsIterable,
        pageLimit,
        desiredEntries
      );
      failedQueries += await this.processTagForType(
        MediaType.TV,
        tag,
        runId,
        tmdb.getDiscoverTv,
        TvSortOptionsIterable,
        pageLimit,
        desiredEntries
      );
    }

    if (invalidKeywords.size > 0) {
      const cleanedTags = blocklistedTagsArr.join(',');

      if (cleanedTags !== blocklistedTags) {
        await settings.persistSection('main', (current) => ({
          ...current,
          blocklistedTags: cleanedTags,
        }));

        logger.info('Cleaned up invalid keywords from settings', {
          label: 'Blocklisted Tags Processor',
          removedKeywords: Array.from(invalidKeywords),
          newBlocklistedTags: cleanedTags,
        });
      }
    } else if (blocklistedTagsArr.join(',') !== blocklistedTags) {
      await settings.persistSection('main', (current) => ({
        ...current,
        blocklistedTags: blocklistedTagsArr.join(','),
      }));
    }

    if (failedQueries > 0) {
      throw new Error(
        `Blocklisted tag collection failed for ${failedQueries} queries.`
      );
    }

    return desiredEntries;
  }

  private async processTagForType<S extends string>(
    mediaType: MediaType.MOVIE | MediaType.TV,
    keywordId: string,
    runId: symbol,
    getDiscover: (options: {
      page: number;
      sortBy?: S;
      keywords: string;
    }) => Promise<TmdbSearchMovieResponse | TmdbSearchTvResponse>,
    sortOptions: readonly S[],
    pageLimit: number,
    desiredEntries: Map<string, DesiredBlocklistEntry>
  ): Promise<number> {
    let queryMax = pageLimit * sortOptions.length;
    let fixedSortMode = false;
    let failedQueries = 0;

    for (let query = 0; query < queryMax; query++) {
      const page = fixedSortMode
        ? query + 1
        : Math.floor(query / sortOptions.length) + 1;
      const sortBy = fixedSortMode
        ? undefined
        : sortOptions[query % sortOptions.length];

      this.assertActive(runId);

      try {
        const response = await getDiscover({
          page,
          sortBy,
          keywords: keywordId,
        });
        this.collectResults(response, keywordId, mediaType, desiredEntries);
        await this.delay(TMDB_API_DELAY_MS);
        this.progress++;

        if (page === 1 && response.total_pages <= queryMax) {
          this.progress += queryMax - response.total_pages;
          fixedSortMode = true;
          queryMax = response.total_pages;
        }
      } catch (error) {
        failedQueries++;
        logger.error('Error processing keyword in blocklisted tags', {
          label: 'Blocklisted Tags Processor',
          keywordId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return failedQueries;
  }

  private collectResults(
    response: TmdbSearchMovieResponse | TmdbSearchTvResponse,
    keywordId: string,
    mediaType: MediaType,
    desiredEntries: Map<string, DesiredBlocklistEntry>
  ): void {
    for (const entry of response.results) {
      const key = `${mediaType}:${entry.id}`;
      const existing = desiredEntries.get(key);
      if (existing) {
        existing.keywordIds.add(keywordId);
      } else {
        this.assertEntryLimit(desiredEntries.size + 1);
        desiredEntries.set(key, {
          mediaType: mediaType as MediaType.MOVIE | MediaType.TV,
          title: 'title' in entry ? entry.title : entry.name,
          tmdbId: entry.id,
          keywordIds: new Set([keywordId]),
        });
      }
    }
  }

  private async reconcileBlocklistEntries(
    desiredEntries: Map<string, DesiredBlocklistEntry>,
    em: EntityManager,
    runId: symbol
  ): Promise<void> {
    const blocklistRepository = em.getRepository(Blocklist);
    const automaticEntries = await blocklistRepository.find({
      where: { blocklistedTags: Not(IsNull()) },
      order: { id: 'ASC' },
      take: this.maxEntries + 1,
      loadEagerRelations: false,
    });
    this.assertEntryLimit(automaticEntries.length);
    const retainedKeys = new Set<string>();

    for (const automaticEntry of automaticEntries) {
      this.assertActive(runId);
      const key = `${automaticEntry.mediaType}:${automaticEntry.tmdbId}`;
      const desiredEntry = desiredEntries.get(key);

      if (!desiredEntry || retainedKeys.has(key)) {
        await Blocklist.removeFromBlocklist(automaticEntry, em);
        continue;
      }

      const blocklistedTags = `,${[...desiredEntry.keywordIds].join(',')},`;
      if (
        automaticEntry.title !== desiredEntry.title ||
        automaticEntry.blocklistedTags !== blocklistedTags
      ) {
        automaticEntry.title = desiredEntry.title;
        automaticEntry.blocklistedTags = blocklistedTags;
        await blocklistRepository.save(automaticEntry);
      }
      retainedKeys.add(key);
    }

    for (const [key, entry] of desiredEntries) {
      this.assertActive(runId);
      if (retainedKeys.has(key)) {
        continue;
      }

      const existing = await blocklistRepository.findOne({
        where: { tmdbId: entry.tmdbId, mediaType: entry.mediaType },
      });

      // Manual blocklists remain manual and must not be converted into
      // automatically managed tag entries.
      if (!existing) {
        await Blocklist.addToBlocklist(
          {
            blocklistRequest: {
              mediaType: entry.mediaType,
              title: entry.title,
              tmdbId: entry.tmdbId,
              blocklistedTags: `,${[...entry.keywordIds].join(',')},`,
            },
          },
          em
        );
      }
    }
  }
}

const blocklistedTagsProcessor = new BlocklistedTagProcessor();

export default blocklistedTagsProcessor;
