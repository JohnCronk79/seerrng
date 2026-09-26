import ExternalAPI from '@server/api/externalapi';
import type { MylarSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';

// Mylar3's `?apikey=&cmd=` API is not uniformly enveloped - confirmed by
// reading the running app's own mylar/api.py, not by guessing. Most commands
// return { success, data }, but several (getWanted, findComic, getUpcoming,
// getLogs) return raw JSON, and forceSearch returns plain text "OK". This
// client only wraps the commands SeerrNG actually needs, all of which use the
// enveloped shape.
interface MylarEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: number; message: string };
}

export interface MylarComic {
  id: string;
  name: string;
  imageURL?: string;
  status?: string;
  publisher?: string;
  year?: string;
  latestIssue?: string;
  totalIssues?: number;
}

export interface MylarIssue {
  id: string;
  name?: string;
  number?: string;
  releaseDate?: string;
  issueDate?: string;
  status?: string;
}

export interface MylarComicDetail {
  comic?: MylarComic;
  issues: MylarIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedString = (value: unknown, maxLength = 512): string | undefined =>
  typeof value === 'string' && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;

const boundedInteger = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
};

const sanitizeComic = (value: unknown): MylarComic | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedString(value.id, 64);
  const name = boundedString(value.name, 1_000);
  if (!id || !name) {
    return undefined;
  }
  return {
    id,
    name,
    imageURL: boundedString(value.imageURL, 2048),
    status: boundedString(value.status, 64),
    publisher: boundedString(value.publisher, 512),
    year: boundedString(value.year, 8),
    latestIssue: boundedString(value.latestIssue, 64),
    totalIssues: boundedInteger(value.totalIssues),
  };
};

const sanitizeIssue = (value: unknown): MylarIssue | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedString(value.id, 64);
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: boundedString(value.name, 1_000),
    number: boundedString(value.number, 32),
    releaseDate: boundedString(value.releaseDate, 32),
    issueDate: boundedString(value.issueDate, 32),
    status: boundedString(value.status, 64),
  };
};

class MylarAPI extends ExternalAPI {
  static buildUrl(
    settings: Pick<MylarSettings, 'useSsl' | 'hostname' | 'port' | 'baseUrl'>,
    path?: string
  ): string {
    return buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.port,
      urlBase: settings.baseUrl,
      path,
    });
  }

  private readonly apiKey: string;

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super(url, {}, { allowPrivateAddresses: true });
    this.apiKey = apiKey;
  }

  private async runCommand<T>(
    cmd: string,
    params: Record<string, unknown> = {},
    ttl = 0
  ): Promise<T> {
    const response = await this.get<MylarEnvelope<T>>(
      '/api',
      { params: { apikey: this.apiKey, cmd, ...params } },
      ttl
    );
    if (!isRecord(response) || response.success !== true) {
      const message = isRecord(response)
        ? boundedString(
            isRecord(response.error) ? response.error.message : undefined
          )
        : undefined;
      throw new Error(
        `Mylar3 command "${cmd}" failed${message ? `: ${message}` : '.'}`
      );
    }
    return response.data as T;
  }

  public async getVersion(): Promise<{ current_version: string | null }> {
    return this.runCommand('getVersion');
  }

  public async getIndex(): Promise<MylarComic[]> {
    const data = await this.runCommand<unknown>('getIndex');
    return Array.isArray(data)
      ? data.map(sanitizeComic).filter((comic): comic is MylarComic => !!comic)
      : [];
  }

  public async getComic(comicId: string): Promise<MylarComicDetail> {
    const data = await this.runCommand<{
      comic?: unknown[];
      issues?: unknown[];
    }>('getComic', { id: comicId });
    return {
      comic: Array.isArray(data.comic)
        ? sanitizeComic(data.comic[0])
        : undefined,
      issues: Array.isArray(data.issues)
        ? data.issues
            .map(sanitizeIssue)
            .filter((issue): issue is MylarIssue => !!issue)
        : [],
    };
  }

  // `id` is the ComicVine volume ID - Mylar3 uses it as the comic's own
  // ComicID too (confirmed by _addComic delegating straight to
  // WebInterface.addbyid(id)), so the same value round-trips through
  // getComic(id) once the async add completes.
  public async addComic(comicVineId: string): Promise<void> {
    await this.runCommand('addComic', { id: comicVineId });
  }
}

export default MylarAPI;
