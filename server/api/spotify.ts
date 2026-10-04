import ExternalAPI from '@server/api/externalapi';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import axios from 'axios';

const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com/api/token';
const MAX_SPOTIFY_ITEMS = 200;
const SPOTIFY_PAGE_SIZE = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, maxLength = 512): string =>
  typeof value === 'string' ? value.slice(0, maxLength).trim() : '';

const safeHttpsUrl = (value: unknown): string | undefined => {
  const candidate = text(value, 2_048);
  if (!candidate) {
    return undefined;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export interface SpotifyPlaylistTrack {
  title: string;
  artists: string[];
  albumTitle: string;
  albumId?: string;
  albumReleaseDate?: string;
  albumImage?: string;
  sourceUrl?: string;
}

export interface SpotifyPlaylistItems {
  name: string;
  url: string;
  tracks: SpotifyPlaylistTrack[];
}

export interface SpotifyTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
}

export const parseSpotifyPlaylistUrl = (
  value: unknown
): { id: string; url: string } | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const raw = value.trim();
  const uriMatch = raw.match(/^spotify:playlist:([A-Za-z0-9]{1,100})$/u);
  if (uriMatch) {
    return {
      id: uriMatch[1],
      url: `https://open.spotify.com/playlist/${uriMatch[1]}`,
    };
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      !['open.spotify.com', 'spotify.com'].includes(url.hostname)
    ) {
      return undefined;
    }
    const [resource, id] = url.pathname.split('/').filter(Boolean);
    if (resource !== 'playlist' || !id || !/^[A-Za-z0-9]{1,100}$/u.test(id)) {
      return undefined;
    }
    return {
      id,
      url: `https://open.spotify.com/playlist/${id}`,
    };
  } catch {
    return undefined;
  }
};

const getSpotifyCredentials = (
  clientId: string,
  clientSecret: string
): string =>
  Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

const requestSpotifyToken = async (
  params: URLSearchParams,
  clientId: string,
  clientSecret: string
): Promise<SpotifyTokenResponse> => {
  const response = await axios.post<unknown>(
    SPOTIFY_ACCOUNTS_URL,
    params.toString(),
    {
      ...createSafeHttpRequestOptions(),
      timeout: 10_000,
      maxContentLength: 256 * 1024,
      maxBodyLength: 64 * 1024,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${getSpotifyCredentials(clientId, clientSecret)}`,
      },
    }
  );

  if (!isRecord(response.data)) {
    throw new Error('Spotify returned an invalid token response.');
  }

  const accessToken = text(response.data.access_token, 4_096);
  const refreshToken = text(response.data.refresh_token, 4_096) || undefined;
  const expiresIn = Number(response.data.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Spotify returned an invalid token response.');
  }

  return { accessToken, refreshToken, expiresIn };
};

export class SpotifyAPI extends ExternalAPI {
  constructor(accessToken: string) {
    super(
      SPOTIFY_API_URL,
      {},
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  }

  public static async exchangeAuthorizationCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  }: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<SpotifyTokenResponse> {
    return requestSpotifyToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      clientId,
      clientSecret
    );
  }

  public static async refreshAccessToken({
    refreshToken,
    clientId,
    clientSecret,
  }: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<SpotifyTokenResponse> {
    return requestSpotifyToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      clientId,
      clientSecret
    );
  }

  public async getProfile(): Promise<SpotifyProfile> {
    const data = await this.get<unknown>('/me', undefined, 0);
    if (!isRecord(data)) {
      throw new Error('Spotify returned an invalid profile.');
    }
    const id = text(data.id, 256);
    const displayName = text(data.display_name, 256) || id;
    if (!id) {
      throw new Error('Spotify returned an invalid profile.');
    }
    return { id, displayName };
  }

  public async getPlaylistItems({
    id,
    url,
  }: {
    id: string;
    url: string;
  }): Promise<SpotifyPlaylistItems> {
    const playlist = await this.get<unknown>(
      `/playlists/${encodeURIComponent(id)}`,
      {
        params: {
          fields: 'name,external_urls.spotify',
          market: 'US',
        },
      },
      0
    );
    if (!isRecord(playlist)) {
      throw new Error('Spotify returned an invalid playlist.');
    }

    const name = text(playlist.name, 512) || 'Spotify playlist';
    const tracks: SpotifyPlaylistTrack[] = [];
    let offset = 0;

    while (tracks.length < MAX_SPOTIFY_ITEMS) {
      const page = await this.get<unknown>(
        `/playlists/${encodeURIComponent(id)}/items`,
        {
          params: {
            limit: SPOTIFY_PAGE_SIZE,
            offset,
            market: 'US',
          },
        },
        0
      );
      if (!isRecord(page) || !Array.isArray(page.items)) {
        throw new Error('Spotify returned an invalid playlist item page.');
      }

      for (const item of page.items) {
        if (!isRecord(item) || !isRecord(item.track)) {
          continue;
        }
        const track = item.track;
        const title = text(track.name);
        const album = isRecord(track.album) ? track.album : undefined;
        const albumTitle = text(album?.name);
        if (!title || !albumTitle) {
          continue;
        }
        const artists = Array.isArray(track.artists)
          ? track.artists
              .map((artist) => (isRecord(artist) ? text(artist.name) : ''))
              .filter(Boolean)
              .slice(0, 20)
          : [];
        const images = Array.isArray(album?.images) ? album.images : [];
        const albumImage = images
          .map((image) =>
            isRecord(image) ? safeHttpsUrl(image.url) : undefined
          )
          .find((image): image is string => !!image);
        const sourceUrl = isRecord(album?.external_urls)
          ? safeHttpsUrl(album.external_urls.spotify)
          : undefined;

        tracks.push({
          title,
          artists,
          albumTitle,
          albumId: text(album?.id, 128) || undefined,
          albumReleaseDate: text(album?.release_date, 128) || undefined,
          albumImage,
          sourceUrl,
        });

        if (tracks.length >= MAX_SPOTIFY_ITEMS) {
          break;
        }
      }

      const next = text(page.next, 2_048);
      if (!next || page.items.length === 0) {
        break;
      }
      offset += page.items.length;
    }

    return { name, url, tracks };
  }
}

export { MAX_SPOTIFY_ITEMS };

export default SpotifyAPI;
