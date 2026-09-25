import { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolveLibraryRemoval } from './libraryRemoval';

const fixture = vi.hoisted(() => ({
  albums: [] as { id?: number; foreignAlbumId: string }[],
  series: [] as { id?: number; tvdbId: number }[],
  remove: vi.fn(),
  movies: vi.fn(),
}));
vi.mock('@server/lib/externalRuntimeConfig', () => ({
  getExternalRuntimeConfig: () => ({
    radarr: [
      {
        id: 0,
        name: 'Radarr-HD',
        apiKey: 'test',
        externalUrl: 'http://test.invalid',
        is4k: false,
      },
      {
        id: 1,
        name: 'Radarr-4K',
        apiKey: 'test',
        externalUrl: 'http://test.invalid',
        is4k: true,
      },
    ],
    lidarr: [
      {
        id: 0,
        name: 'Lidarr Test',
        apiKey: 'test',
        externalUrl: 'http://test.invalid',
      },
    ],
    sonarr: [
      {
        id: 1,
        name: 'Sonarr Test',
        apiKey: 'test',
        externalUrl: 'http://test.invalid',
      },
    ],
  }),
}));
vi.mock('@server/api/servarr/lidarr', () => ({
  default: class {
    static buildUrl() {
      return 'http://test.invalid/api/v1';
    }
    getAlbums() {
      return Promise.resolve(fixture.albums);
    }
    removeAlbum(id: number) {
      return fixture.remove(id);
    }
  },
}));
vi.mock('@server/api/servarr/radarr', () => ({
  default: class {
    static buildUrl() {
      return 'http://test.invalid/api/v3';
    }
    getMovies(options: unknown) {
      return fixture.movies(options);
    }
    removeMovieById(id: number) {
      return fixture.remove(id);
    }
  },
}));
vi.mock('@server/api/servarr/sonarr', () => ({
  default: class {
    static buildUrl() {
      return 'http://test.invalid/api/v3';
    }
    getSeries() {
      return Promise.resolve(fixture.series);
    }
    removeSeriesById(id: number) {
      return fixture.remove(id);
    }
  },
}));
vi.mock('@server/api/servarr/readarr', () => ({ default: class {} }));

const media = { id: 42, mediaType: MediaType.MUSIC, mbId: 'album-id' } as Media;
beforeEach(() => {
  fixture.albums = [];
  fixture.series = [];
  fixture.remove.mockReset();
  fixture.movies.mockReset();
});

it('queries only the exact movie with strict verification across every Radarr service', async () => {
  fixture.movies.mockResolvedValue([{ id: 9, tmdbId: 123 }]);
  const resolved = await resolveLibraryRemoval({
    id: 44,
    mediaType: MediaType.MOVIE,
    tmdbId: 123,
  } as Media);
  expect(fixture.movies.mock.calls).toEqual([
    [{ tmdbId: 123, strict: true }],
    [{ tmdbId: 123, strict: true }],
  ]);
  expect(
    resolved.plan.targets.map(({ service, quality }) => ({ service, quality }))
  ).toEqual([
    { service: 'Radarr-HD', quality: 'HD' },
    { service: 'Radarr-4K', quality: '4K' },
  ]);
  expect(fixture.remove).not.toHaveBeenCalled();
});

it('fails the whole movie preflight if one service cannot be verified', async () => {
  fixture.movies
    .mockResolvedValueOnce([{ id: 9, tmdbId: 123 }])
    .mockRejectedValueOnce(new Error('Unavailable'));
  await expect(
    resolveLibraryRemoval({
      id: 44,
      mediaType: MediaType.MOVIE,
      tmdbId: 123,
    } as Media)
  ).rejects.toThrow(
    'Unable to verify library copies in Radarr-4K. No deletion has started.'
  );
  expect(fixture.remove).not.toHaveBeenCalled();
});

it.each([undefined, 0, -1, 1.5])(
  'rejects a matched series with invalid ID %s without removal',
  async (id) => {
    fixture.series = [{ id, tvdbId: 123 }];
    await expect(
      resolveLibraryRemoval({
        id: 43,
        mediaType: MediaType.TV,
        tvdbId: 123,
      } as Media)
    ).rejects.toThrow(
      'Unable to verify library copies in Sonarr Test. No deletion has started.'
    );
    expect(fixture.remove).not.toHaveBeenCalled();
  }
);

it('resolves the exact series without removing it during a lookup', async () => {
  fixture.series = [
    { id: 9, tvdbId: 123 },
    { id: 10, tvdbId: 124 },
  ];
  const resolved = await resolveLibraryRemoval({
    id: 43,
    mediaType: MediaType.TV,
    tvdbId: 123,
  } as Media);
  expect(resolved.plan.targets).toHaveLength(1);
  expect(resolved.plan.targets[0]).toMatchObject({
    externalId: 9,
    service: 'Sonarr Test',
  });
  expect(fixture.remove).not.toHaveBeenCalled();
  await resolved.remove(resolved.plan.targets[0]);
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it.each([undefined, 0, -1, 1.5])(
  'rejects a matched album with invalid ID %s without any removal',
  async (id) => {
    fixture.albums = [{ id, foreignAlbumId: 'album-id' }];
    await expect(resolveLibraryRemoval(media)).rejects.toThrow(
      'Unable to verify library copies in Lidarr Test. No deletion has started.'
    );
    expect(fixture.remove).not.toHaveBeenCalled();
  }
);

it('resolves the exact album and keeps reading separate from removal', async () => {
  fixture.albums = [
    { id: 9, foreignAlbumId: 'album-id' },
    { id: 10, foreignAlbumId: 'other' },
  ];
  const resolved = await resolveLibraryRemoval(media);
  expect(resolved.plan.targets).toHaveLength(1);
  expect(resolved.plan.targets[0]).toMatchObject({
    externalId: 9,
    serviceId: 0,
    service: 'Lidarr Test',
  });
  expect(fixture.remove).not.toHaveBeenCalled();
  await resolved.remove(resolved.plan.targets[0]);
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(9);
});
