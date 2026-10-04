import { assertNoSymlinkDirectoryComponents } from '@server/lib/pathSecurity';
import logger from '@server/logger';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import axios from 'axios';
import { randomUUID } from 'crypto';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import xml2js from 'xml2js';

const UPDATE_INTERVAL_MSEC = 24 * 3600 * 1000; // how often to download new mapping in milliseconds
const DOWNLOAD_TIMEOUT_MS = 30_000;
export const MAX_MAPPING_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_MAPPING_FILE_BYTES = MAX_MAPPING_DOWNLOAD_BYTES;
// originally at https://raw.githubusercontent.com/ScudLee/anime-lists/master/anime-list.xml
const MAPPING_URL =
  'https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list.xml';
const LOCAL_PATH = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/anime-list.xml`
  : path.join(__dirname, '../../config/anime-list.xml');

const mappingRegexp = new RegExp(/;[0-9]+-([0-9]+)/g);
export const MAX_ANIME_MAPPING_ENTRIES = 100_000;
export const MAX_ANIME_MAPPING_RULES = 500_000;
const MAX_ANIME_EXTERNAL_IDS = 100;
const MAX_ANIME_PROVIDER_ID = 1_000_000_000;
const MAX_ANIME_EPISODE = 100_000;
const MAX_ANIME_MAPPING_TEXT_LENGTH = 100_000;

export const createSizeLimitTransform = (maxBytes: number): Transform => {
  let bytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;

      if (bytes > maxBytes) {
        callback(new Error('Anime-List mapping download exceeds maximum size'));
        return;
      }

      callback(null, chunk);
    },
  });
};

export const assertMappingFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_MAPPING_FILE_BYTES) {
    throw new Error('Anime-List mapping file exceeds maximum size');
  }
};

export const readMappingFile = async (filePath: string) => {
  assertNoSymlinkDirectoryComponents(path.dirname(filePath), {
    label: 'Anime-List mapping directory',
  });
  const handle = await fsp.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );

  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw new Error('Anime-List mapping path is not a regular file');
    }
    assertMappingFileSize(fileStat.size);
    return { data: await handle.readFile(), modified: fileStat.mtime };
  } finally {
    await handle.close();
  }
};

export const writeMappingFileAtomically = async (
  source: Readable,
  filePath: string
) => {
  assertNoSymlinkDirectoryComponents(path.dirname(filePath), {
    label: 'Anime-List mapping directory',
  });
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;

  try {
    await pipeline(
      source,
      createSizeLimitTransform(MAX_MAPPING_DOWNLOAD_BYTES),
      fs.createWriteStream(temporaryPath, {
        flags: 'wx',
        mode: 0o600,
      })
    );
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {
      // Best-effort cleanup only.
    });
    throw error;
  }
};

// Anime-List xml files are community maintained mappings that Hama agent uses to map AniDB IDs to TVDB/TMDB IDs
// https://github.com/Anime-Lists/anime-lists/

interface AnimeMapping {
  $: {
    anidbseason: string;
    tvdbseason: string;
  };
  _: string;
}

interface Anime {
  $: {
    anidbid: number;
    tvdbid?: string;
    defaulttvdbseason?: string;
    tmdbid?: number;
    imdbid?: string;
  };
  'mapping-list'?: {
    mapping: AnimeMapping[];
  }[];
}

interface AnimeList {
  'anime-list': {
    anime: Anime[];
  };
}

export interface AnidbItem {
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  tvdbSeason?: number;
}

export const parseAnimeListMappings = (
  value: unknown
): {
  mapping: { [anidbId: number]: AnidbItem };
  specials: { [tvdbId: number]: { [episode: number]: AnidbItem } };
} => {
  if (!value || typeof value !== 'object') {
    throw new Error('Anime-List mapping document is invalid');
  }
  const root = (value as Record<string, unknown>)['anime-list'];
  const animeEntries =
    root && typeof root === 'object'
      ? (root as Record<string, unknown>).anime
      : undefined;
  if (!Array.isArray(animeEntries)) {
    throw new Error('Anime-List mapping entries are invalid');
  }
  if (animeEntries.length > MAX_ANIME_MAPPING_ENTRIES) {
    throw new Error('Anime-List mapping contains too many entries');
  }

  const mapping: { [anidbId: number]: AnidbItem } = {};
  const specials: {
    [tvdbId: number]: { [episode: number]: AnidbItem };
  } = {};
  let mappingRules = 0;
  const positiveId = (id: unknown): number | undefined => {
    const parsed = typeof id === 'number' ? id : Number(id);
    return Number.isSafeInteger(parsed) &&
      parsed > 0 &&
      parsed <= MAX_ANIME_PROVIDER_ID
      ? parsed
      : undefined;
  };

  for (const rawAnime of animeEntries) {
    if (!rawAnime || typeof rawAnime !== 'object') {
      continue;
    }
    const anime = rawAnime as unknown as Anime;
    if (!anime.$ || typeof anime.$ !== 'object') {
      continue;
    }
    const anidbId = positiveId(anime.$.anidbid);
    if (!anidbId) {
      continue;
    }
    const tvdbId = positiveId(anime.$.tvdbid);
    const tmdbId = positiveId(anime.$.tmdbid);
    const defaultSeason = Number(anime.$.defaulttvdbseason);
    const tvdbSeason =
      Number.isSafeInteger(defaultSeason) &&
      defaultSeason >= 0 &&
      defaultSeason <= MAX_ANIME_EPISODE
        ? defaultSeason
        : undefined;
    const imdbIds =
      typeof anime.$.imdbid === 'string'
        ? anime.$.imdbid
            .split(',')
            .slice(0, MAX_ANIME_EXTERNAL_IDS)
            .map((id) => id.trim())
            .filter((id) => /^tt[0-9]{1,20}$/.test(id))
        : [];

    mapping[anidbId] = {
      tvdbId: tvdbSeason === 0 ? undefined : tvdbId,
      tmdbId,
      imdbId: imdbIds[0],
      tvdbSeason,
    };

    if (!tvdbId) {
      continue;
    }
    const mappingList = Array.isArray(anime['mapping-list'])
      ? anime['mapping-list'][0]
      : undefined;
    const rules = Array.isArray(mappingList?.mapping)
      ? mappingList.mapping
      : [];

    if (rules.length) {
      let imdbIndex = 0;
      for (const rule of rules) {
        mappingRules += 1;
        if (mappingRules > MAX_ANIME_MAPPING_RULES) {
          throw new Error('Anime-List mapping contains too many rules');
        }
        if (
          !rule ||
          typeof rule !== 'object' ||
          !rule.$ ||
          rule.$.tvdbseason !== '0' ||
          typeof rule._ !== 'string' ||
          rule._.length > MAX_ANIME_MAPPING_TEXT_LENGTH
        ) {
          continue;
        }
        mappingRegexp.lastIndex = 0;
        let matches: RegExpExecArray | null;
        while ((matches = mappingRegexp.exec(rule._)) !== null) {
          const episode = positiveId(matches[1]);
          if (!episode || episode > MAX_ANIME_EPISODE) {
            continue;
          }
          specials[tvdbId] ??= {};
          const imdbId = imdbIds[imdbIndex];
          if (tmdbId || imdbId) {
            specials[tvdbId][episode] = { tmdbId, imdbId };
            imdbIndex += 1;
          }
        }
      }
    } else if ((imdbIds.length || tmdbId) && tvdbSeason === 0) {
      specials[tvdbId] ??= {};
      const itemCount = Math.max(1, imdbIds.length);
      for (let index = 0; index < itemCount; index += 1) {
        specials[tvdbId][index + 1] = {
          tmdbId,
          imdbId: imdbIds[index],
        };
      }
    }
  }

  return { mapping, specials };
};

class AnimeListMapping {
  private syncing = false;

  private mapping: { [anidbId: number]: AnidbItem } = {};

  // mapping file modification date when it was loaded
  private mappingModified: Date | null = null;

  // each episode in season 0 from TVDB can map to movie
  private specials: { [tvdbId: number]: { [episode: number]: AnidbItem } } = {};

  public isLoaded = () => Object.keys(this.mapping).length !== 0;

  private loadFromFile = async () => {
    logger.info('Loading mapping file', { label: 'Anime-List Sync' });
    try {
      const mappingFile = await readMappingFile(LOCAL_PATH);
      const xml = (await xml2js.parseStringPromise(
        mappingFile.data
      )) as AnimeList;

      const parsed = parseAnimeListMappings(xml);
      this.mapping = parsed.mapping;
      this.specials = parsed.specials;
      this.mappingModified = mappingFile.modified;
      logger.info(
        `Loaded ${
          Object.keys(this.mapping).length
        } AniDB items from mapping file`,
        { label: 'Anime-List Sync' }
      );
    } catch (e) {
      throw new Error(`Failed to load Anime-List mappings: ${e.message}`, {
        cause: e,
      });
    }
  };

  private downloadFile = async () => {
    logger.info('Downloading latest mapping file', {
      label: 'Anime-List Sync',
    });
    try {
      const response = await axios.get(MAPPING_URL, {
        ...createSafeHttpRequestOptions(),
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxRedirects: 3,
      });
      const mappingDirectory = path.dirname(LOCAL_PATH);
      assertNoSymlinkDirectoryComponents(mappingDirectory, {
        allowMissing: true,
        label: 'Anime-List mapping directory',
      });
      await fsp.mkdir(mappingDirectory, { recursive: true, mode: 0o700 });
      assertNoSymlinkDirectoryComponents(mappingDirectory, {
        label: 'Anime-List mapping directory',
      });
      await writeMappingFileAtomically(response.data, LOCAL_PATH);
    } catch (e) {
      throw new Error(`Failed to download Anime-List mapping: ${e.message}`, {
        cause: e,
      });
    }
  };

  public sync = async () => {
    // make sure only one sync runs at a time
    if (this.syncing) {
      return;
    }

    this.syncing = true;
    try {
      // check if local file is not "expired" yet
      if (fs.existsSync(LOCAL_PATH)) {
        const now = new Date();
        assertNoSymlinkDirectoryComponents(path.dirname(LOCAL_PATH), {
          label: 'Anime-List mapping directory',
        });
        const stat = await fsp.lstat(LOCAL_PATH);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Anime-List mapping path is not a regular file');
        }
        if (now.getTime() - stat.mtime.getTime() < UPDATE_INTERVAL_MSEC) {
          if (!this.isLoaded()) {
            // no need to download, but make sure file is loaded
            await this.loadFromFile();
          } else if (
            this.mappingModified &&
            stat.mtime.getTime() > this.mappingModified.getTime()
          ) {
            // if file has been modified externally since last load, reload it
            await this.loadFromFile();
          }
          return;
        }
      }
      await this.downloadFile();
      await this.loadFromFile();
    } finally {
      this.syncing = false;
    }
  };

  public getFromAnidbId = (anidbId: number): AnidbItem | undefined => {
    return this.mapping[anidbId];
  };

  public getSpecialEpisode = (
    tvdbId: number,
    episode: number
  ): AnidbItem | undefined => {
    const episodes = this.specials[tvdbId];
    return episodes ? episodes[episode] : undefined;
  };
}

const animeList = new AnimeListMapping();

export default animeList;
