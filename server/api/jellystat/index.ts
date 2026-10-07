import type { JellystatSettings } from '@server/lib/settings';
import {
  createSafeHttpUrl,
  stringifySafeHttpUrl,
} from '@server/utils/security';
import { trimTrailingSlashes } from '@server/utils/serviceUrl';
import axios from 'axios';

/**
 * Jellystat keeps playback history for ten years so item totals are lifetime
 * totals. Its `hours` parameter is a look-back window, not a page size.
 */
export const JELLYSTAT_LIFETIME_HOURS = 24 * 365 * 10;

export interface JellystatItemPlayback {
  plays: number;
  /** Total playback time in seconds, as Jellystat stores `PlaybackDuration`. */
  playbackSeconds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const nonNegativeNumber = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : 0;
};

/** Maps Jellystat's `getGlobalItemStats` row. Postgres returns counts as strings. */
export const mapJellystatItemPlayback = (
  value: unknown
): JellystatItemPlayback => {
  const row = isRecord(value) ? value : {};
  return {
    plays: nonNegativeNumber(row.Plays),
    playbackSeconds: nonNegativeNumber(row.total_playback_duration),
  };
};

export default class JellystatAPI {
  private readonly root: string;

  constructor(private readonly settings: JellystatSettings) {
    this.root = trimTrailingSlashes(settings.url);
  }

  private async requestUrl(path: string): Promise<string> {
    const safeUrl = await createSafeHttpUrl(`${this.root}${path}`, {
      allowPrivateAddresses: true,
    });
    if (!safeUrl) {
      throw new Error('Jellystat service URL is invalid.');
    }
    return stringifySafeHttpUrl(safeUrl);
  }

  private headers(): Record<string, string> {
    return { 'x-api-token': this.settings.apiKey };
  }

  private async assertOk(status: number): Promise<void> {
    if (status === 401 || status === 403) {
      throw new Error('Jellystat rejected the API key.');
    }
    if (status !== 200) {
      throw new Error(`Jellystat returned HTTP ${status}.`);
    }
  }

  /** Confirms the server is reachable and the API key is accepted. */
  public async ping(): Promise<void> {
    const response = await axios.get(
      await this.requestUrl('/stats/getLibraryOverview'),
      {
        headers: this.headers(),
        timeout: 15_000,
        maxRedirects: 0,
        maxContentLength: 4 * 1024 * 1024,
        validateStatus: () => true,
      }
    );
    await this.assertOk(response.status);
    if (!Array.isArray(response.data)) {
      throw new Error('Jellystat returned an invalid library overview.');
    }
  }

  /** Lifetime plays and playback time for one Jellyfin item. */
  public async getItemPlayback(
    jellyfinItemId: string
  ): Promise<JellystatItemPlayback> {
    const response = await axios.post(
      await this.requestUrl('/stats/getGlobalItemStats'),
      { hours: JELLYSTAT_LIFETIME_HOURS, itemid: jellyfinItemId },
      {
        headers: this.headers(),
        timeout: 15_000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        validateStatus: () => true,
      }
    );
    await this.assertOk(response.status);
    return mapJellystatItemPlayback(response.data);
  }
}
