import * as overview from '@server/api/artistOverview';
import CoverArtArchive from '@server/api/coverartarchive';
import MusicBrainz from '@server/api/musicbrainz';
import * as db from '@server/datasource';
import { beforeEach, expect, it, vi } from 'vitest';
import { getCuratedCollection } from './collectionCatalog';

const artistId = '79239441-bfd5-4981-a70c-55c3f15c1287';
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(overview, 'getArtistOverview').mockResolvedValue(null);
  vi.spyOn(MusicBrainz.prototype, 'getArtistAlbumCollection').mockResolvedValue(
    {
      name: 'Madonna',
      albums: [
        {
          id: 'undated',
          title: 'Interview',
          'first-release-date': '',
          'secondary-types': ['Interview'],
        },
        {
          id: 'studio',
          title: 'Madonna',
          'first-release-date': '1983-01-01',
          'secondary-types': [],
        },
      ] as any,
    }
  );
});
it('uses verified cached artwork instead of assuming the first album has a cover', async () => {
  vi.spyOn(db, 'getRepository').mockReturnValue({
    find: vi
      .fn()
      .mockResolvedValue([
        { mbAlbumId: 'studio', caaUrl: 'https://archive.org/cover.jpg' },
      ]),
  } as any);
  const fetch = vi.spyOn(CoverArtArchive.prototype, 'batchGetCoverArt');
  const data = await getCuratedCollection('music', artistId);
  expect(data.posterPath).toBe('https://archive.org/cover.jpg');
  expect(data.parts[0].posterPath).toBeUndefined();
  expect(data.parts[1].posterPath).toBe(data.posterPath);
  expect(fetch).not.toHaveBeenCalled();
  expect(data.overview).toBe('Albums credited to Madonna.');
});
it('resolves only a bounded dated-album sample when no cached cover exists', async () => {
  vi.spyOn(db, 'getRepository').mockReturnValue({
    find: vi.fn().mockResolvedValue([]),
  } as any);
  const fetch = vi
    .spyOn(CoverArtArchive.prototype, 'batchGetCoverArt')
    .mockResolvedValue({ studio: 'https://archive.org/resolved.jpg' });
  const data = await getCuratedCollection('music', artistId);
  expect(fetch).toHaveBeenCalledWith(['studio']);
  expect(data.posterPath).toBe('https://archive.org/resolved.jpg');
});
