import ExternalAPI from '@server/api/externalapi';

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';
const MAX_YOUTUBE_ITEMS = 200;
const YOUTUBE_PAGE_SIZE = 50;

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

export interface YouTubePlaylistTrack {
  title: string;
  artist?: string;
  sourceUrl: string;
}

export interface YouTubePlaylistItems {
  name: string;
  url: string;
  tracks: YouTubePlaylistTrack[];
}

export const parseYouTubePlaylistUrl = (
  value: unknown
): { id: string; url: string } | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    const allowedHosts = new Set([
      'youtube.com',
      'www.youtube.com',
      'music.youtube.com',
      'm.youtube.com',
      'youtu.be',
    ]);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      return undefined;
    }
    const id = url.searchParams.get('list') ?? '';
    if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) {
      return undefined;
    }
    return {
      id,
      url: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
    };
  } catch {
    return undefined;
  }
};

export class YouTubeAPI extends ExternalAPI {
  constructor(apiKey: string) {
    super(
      YOUTUBE_API_URL,
      { key: apiKey },
      {
        headers: { Accept: 'application/json' },
        rateLimit: { maxRequests: 10, maxRPS: 5 },
      }
    );
  }

  public async getPlaylistItems({
    id,
    url,
  }: {
    id: string;
    url: string;
  }): Promise<YouTubePlaylistItems> {
    const playlist = await this.get<unknown>(
      '/playlists',
      {
        params: { part: 'snippet', id },
      },
      0
    );
    const playlistItem =
      isRecord(playlist) && Array.isArray(playlist.items)
        ? playlist.items[0]
        : undefined;
    const playlistSnippet =
      isRecord(playlistItem) && isRecord(playlistItem.snippet)
        ? playlistItem.snippet
        : undefined;
    const name = text(playlistSnippet?.title) || 'YouTube playlist';

    const tracks: YouTubePlaylistTrack[] = [];
    let pageToken: string | undefined;

    while (tracks.length < MAX_YOUTUBE_ITEMS) {
      const page = await this.get<unknown>(
        '/playlistItems',
        {
          params: {
            part: 'snippet,contentDetails,status',
            playlistId: id,
            maxResults: YOUTUBE_PAGE_SIZE,
            ...(pageToken ? { pageToken } : {}),
          },
        },
        0
      );
      if (!isRecord(page) || !Array.isArray(page.items)) {
        throw new Error('YouTube returned an invalid playlist item page.');
      }

      for (const item of page.items) {
        if (!isRecord(item) || !isRecord(item.snippet)) {
          continue;
        }
        const snippet = item.snippet;
        const title = text(snippet.title);
        const resourceId = isRecord(snippet.resourceId)
          ? text(snippet.resourceId.videoId, 128)
          : '';
        if (!title || !resourceId) {
          continue;
        }
        const artist = text(snippet.videoOwnerChannelTitle) || undefined;
        const sourceUrl = safeHttpsUrl(
          `https://www.youtube.com/watch?v=${encodeURIComponent(resourceId)}&list=${encodeURIComponent(id)}`
        );
        if (!sourceUrl) {
          continue;
        }
        tracks.push({ title, artist, sourceUrl });
        if (tracks.length >= MAX_YOUTUBE_ITEMS) {
          break;
        }
      }

      const nextPageToken = text(page.nextPageToken, 256);
      if (!nextPageToken || page.items.length === 0) {
        break;
      }
      pageToken = nextPageToken;
    }

    return { name, url, tracks };
  }
}

export { MAX_YOUTUBE_ITEMS };

export default YouTubeAPI;
