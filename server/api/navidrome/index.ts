import { createHash, randomBytes } from 'node:crypto';

import type { NavidromeSettings } from '@server/lib/settings';
import axios from 'axios';

/** Subsonic API version this client speaks; Navidrome accepts 1.16.1 and newer. */
export const SUBSONIC_API_VERSION = '1.16.1';
export const SUBSONIC_CLIENT_NAME = 'SeerrNG';
export const NAVIDROME_ALBUM_PAGE_SIZE = 500;
export const NAVIDROME_MAX_ALBUM_PAGES = 200;

export interface NavidromeAlbum {
  id: string;
  name: string;
  artist?: string;
  /** OpenSubsonic `musicBrainzId` on AlbumID3; albums without one cannot be matched. */
  musicBrainzId?: string;
}

interface SubsonicEnvelope {
  'subsonic-response'?: {
    status?: unknown;
    error?: { code?: unknown; message?: unknown };
    albumList2?: { album?: unknown };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedString = (value: unknown, maxLength = 512): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\r\n\0]+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
};

/** Subsonic token auth: `t = md5(password + salt)` with a fresh salt per request. */
export const subsonicAuthParams = (
  username: string,
  password: string,
  salt: string = randomBytes(8).toString('hex')
): { u: string; t: string; s: string; v: string; c: string; f: string } => ({
  u: username,
  t: createHash('md5').update(`${password}${salt}`).digest('hex'),
  s: salt,
  v: SUBSONIC_API_VERSION,
  c: SUBSONIC_CLIENT_NAME,
  f: 'json',
});

/** Maps one AlbumID3 row; rows with no usable ID are dropped. */
export const mapNavidromeAlbum = (
  value: unknown
): NavidromeAlbum | undefined => {
  if (!isRecord(value)) return undefined;
  const id = boundedString(value.id, 128);
  const name = boundedString(value.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    artist: boundedString(value.artist),
    musicBrainzId: boundedString(value.musicBrainzId, 64),
  };
};

export default class NavidromeAPI {
  private readonly root: string;

  constructor(private readonly settings: NavidromeSettings) {
    this.root = `${settings.url.replace(/\/+$/, '')}/rest`;
  }

  /** Calls one Subsonic method and returns the decoded `subsonic-response`. */
  private async call(
    method: string,
    params: Record<string, string | number> = {}
  ): Promise<Record<string, unknown>> {
    const response = await axios.get<SubsonicEnvelope>(
      `${this.root}/${method}.view`,
      {
        params: {
          ...subsonicAuthParams(this.settings.username, this.settings.password),
          ...params,
        },
        timeout: 15_000,
        maxContentLength: 16 * 1024 * 1024,
        maxRedirects: 0,
        validateStatus: () => true,
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error('Navidrome rejected the username or password.');
    }
    if (response.status !== 200 || !isRecord(response.data)) {
      throw new Error(`Navidrome returned HTTP ${response.status}.`);
    }

    const body = response.data['subsonic-response'];
    if (!isRecord(body)) {
      throw new Error('Navidrome returned an invalid Subsonic response.');
    }
    if (body.status !== 'ok') {
      const error = isRecord(body.error) ? body.error : {};
      const message = boundedString(error.message, 200) ?? 'Unknown error.';
      throw new Error(`Navidrome returned an error: ${message}`);
    }
    return body;
  }

  /** Confirms the server is reachable and the credentials are accepted. */
  public async ping(): Promise<void> {
    await this.call('ping');
  }

  /**
   * Returns one page of albums, alphabetical by name. Callers stop when a
   * page comes back shorter than the requested size.
   */
  public async getAlbumsPage(
    offset: number,
    size = NAVIDROME_ALBUM_PAGE_SIZE
  ): Promise<NavidromeAlbum[]> {
    const body = await this.call('getAlbumList2', {
      type: 'alphabeticalByName',
      size: Math.min(Math.max(1, size), 500),
      offset: Math.max(0, offset),
    });
    const list = isRecord(body.albumList2) ? body.albumList2.album : undefined;
    if (list !== undefined && !Array.isArray(list)) {
      throw new Error('Navidrome returned an invalid album list.');
    }
    return (list ?? [])
      .map(mapNavidromeAlbum)
      .filter((album): album is NavidromeAlbum => !!album);
  }
}
