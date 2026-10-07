import NavidromeAPI, {
  type NavidromeAlbum,
  NAVIDROME_ALBUM_PAGE_SIZE,
  NAVIDROME_MAX_ALBUM_PAGES,
} from '@server/api/navidrome';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import logger from '@server/logger';

/**
 * Reads every album page. Stops on a short page; throws when the library
 * exceeds the page cap instead of returning a partial catalogue.
 */
export const fetchAllNavidromeAlbums = async (
  api: Pick<NavidromeAPI, 'getAlbumsPage'>
): Promise<NavidromeAlbum[]> => {
  const albums: NavidromeAlbum[] = [];
  for (let page = 0; page < NAVIDROME_MAX_ALBUM_PAGES; page += 1) {
    const offset = page * NAVIDROME_ALBUM_PAGE_SIZE;
    const rows = await api.getAlbumsPage(offset, NAVIDROME_ALBUM_PAGE_SIZE);
    albums.push(...rows);
    if (rows.length < NAVIDROME_ALBUM_PAGE_SIZE) {
      return albums;
    }
  }
  throw new Error(
    `Navidrome library exceeds the ${NAVIDROME_MAX_ALBUM_PAGES * NAVIDROME_ALBUM_PAGE_SIZE}-album scan limit.`
  );
};

class NavidromeScanner
  extends BaseScanner<NavidromeAlbum>
  implements RunnableScanner<StatusBase>
{
  constructor() {
    super('Navidrome Scan', { bundleSize: 10 });
  }

  public status(): StatusBase {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
    };
  }

  public async run(): Promise<void> {
    const settings = getExternalRuntimeConfig().navidrome;
    if (!settings?.syncEnabled) return;

    const sessionId = this.startRun();
    if (!sessionId) return;

    try {
      const albums = await fetchAllNavidromeAlbums(new NavidromeAPI(settings));
      // Only albums with a MusicBrainz ID can be matched to music requests.
      this.items = albums.filter((album) => !!album.musicBrainzId);
      await this.loop(this.processItem.bind(this), { sessionId });
      logger.info('Navidrome library scan complete', {
        label: 'Navidrome',
        albumCount: albums.length,
        matchableCount: this.items.length,
      });
    } catch (error) {
      logger.error('Navidrome library scan failed', {
        label: 'Navidrome',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processItem(album: NavidromeAlbum): Promise<void> {
    if (!album.musicBrainzId) return;
    const mbId = normalizeMusicBrainzId(album.musicBrainzId);
    if (!mbId) return;

    await this.processMusic(mbId, {
      title: album.name,
      hasFile: true,
    });
  }
}

export const navidromeScanner = new NavidromeScanner();
