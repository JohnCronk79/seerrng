import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaSearchMetadata } from '@server/entity/MediaSearchMetadata';
import { getLidarrAlbumMediaStatus } from '@server/lib/musicAvailability';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

let getAlbumsImpl: () => Promise<LidarrAlbum[]> = async () => [];
let getArtistIdsImpl: () => Promise<number[]> = async () => [1];
let getAlbumsByArtistImpl: (
  artistId: number
) => Promise<LidarrAlbum[]> = async () => getAlbumsImpl();
Object.defineProperty(LidarrAPI.prototype, 'getAlbums', {
  set() {},
  get() {
    return async () => getAlbumsImpl();
  },
  configurable: true,
});
Object.defineProperty(LidarrAPI.prototype, 'getArtistIds', {
  set() {},
  get() {
    return async () => getArtistIdsImpl();
  },
  configurable: true,
});
Object.defineProperty(LidarrAPI.prototype, 'getAlbumsByArtist', {
  set() {},
  get() {
    return async (artistId: number) => getAlbumsByArtistImpl(artistId);
  },
  configurable: true,
});

import { lidarrScanner } from '@server/lib/scanners/lidarr';

setupTestDb();

function configureLidarr(overrides: Partial<LidarrSettings>[] = [{}]): void {
  const settings = getSettings();
  settings.lidarr = overrides.map((o, i) => ({
    id: i,
    name: `Lidarr ${i}`,
    hostname: 'localhost',
    port: 8686,
    apiKey: 'test-key',
    baseUrl: '',
    useSsl: false,
    activeProfileId: 1,
    activeMetadataProfileId: 1,
    activeDirectory: '/music',
    isDefault: i === 0,
    syncEnabled: true,
    preventSearch: false,
    externalUrl: '',
    tags: [],
    ...o,
  })) as LidarrSettings[];
}

function fakeLidarrAlbum(overrides: Partial<LidarrAlbum> = {}): LidarrAlbum {
  return {
    id: 1,
    mbId: 'release-id',
    title: 'Test Album',
    monitored: true,
    artistId: 1,
    foreignAlbumId: 'release-group-id',
    titleSlug: 'test-album',
    profileId: 1,
    duration: 3600,
    albumType: 'Album',
    statistics: {
      trackFileCount: 10,
      trackCount: 10,
      totalTrackCount: 10,
      sizeOnDisk: 1000,
      percentOfTracks: 100,
    },
    ...overrides,
  };
}

describe('Lidarr Scanner', () => {
  beforeEach(() => {
    getAlbumsImpl = async () => [];
    getArtistIdsImpl = async () => [1];
    getAlbumsByArtistImpl = async () => getAlbumsImpl();
  });

  it('scans large libraries through artist batches after the full response exceeds 64 MiB', async () => {
    const mediaRepository = getRepository(Media);
    const artistIds = [11, 22, 33];
    const albumsByArtist = new Map<number, LidarrAlbum[]>(
      artistIds.map((artistId, index) => [
        artistId,
        [
          fakeLidarrAlbum({
            id: 900 + index,
            artistId,
            title: `Large Library Album ${index}`,
            foreignAlbumId: `large-library-album-${index}`,
          }),
        ],
      ])
    );
    let fullLibraryRequests = 0;
    const artistRequests: number[] = [];

    configureLidarr([{ syncEnabled: true }]);
    getArtistIdsImpl = async () => artistIds;
    getAlbumsImpl = async () => {
      fullLibraryRequests += 1;
      throw new Error(
        '[Lidarr] Failed to retrieve albums: maxContentLength size of 67108864 exceeded'
      );
    };
    getAlbumsByArtistImpl = async (artistId) => {
      artistRequests.push(artistId);
      return albumsByArtist.get(artistId) ?? [];
    };

    await lidarrScanner.run();

    assert.equal(fullLibraryRequests, 0);
    assert.deepEqual(artistRequests, artistIds);
    assert.equal(
      await mediaRepository.countBy({ mediaType: MediaType.MUSIC }),
      artistIds.length
    );
    for (let index = 0; index < artistIds.length; index++) {
      assert.ok(
        await mediaRepository.existsBy({
          mbId: `large-library-album-${index}`,
          mediaType: MediaType.MUSIC,
        })
      );
    }
  });

  it('skips orphan cleanup when an artist batch fails partway through', async () => {
    const mediaRepository = getRepository(Media);
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'partial-lidarr-scan-orphan',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getArtistIdsImpl = async () => [101, 102];
    getAlbumsByArtistImpl = async (artistId) => {
      if (artistId === 102) {
        throw new Error(
          '[Lidarr] Failed to retrieve artist albums: maxContentLength size of 67108864 exceeded'
        );
      }
      return [
        fakeLidarrAlbum({
          id: 1_102,
          artistId,
          foreignAlbumId: 'partial-lidarr-scan-imported',
        }),
      ];
    };

    await lidarrScanner.run();

    assert.ok(
      await mediaRepository.existsBy({
        mbId: 'partial-lidarr-scan-imported',
        mediaType: MediaType.MUSIC,
      })
    );
    const untouched = await mediaRepository.findOneByOrFail({
      mbId: 'partial-lidarr-scan-orphan',
      mediaType: MediaType.MUSIC,
    });
    assert.strictEqual(untouched.status, MediaStatus.PROCESSING);
  });

  it('distinguishes waiting, partial, and complete Lidarr albums', () => {
    assert.strictEqual(
      getLidarrAlbumMediaStatus(
        fakeLidarrAlbum({
          statistics: {
            trackFileCount: 0,
            trackCount: 10,
            totalTrackCount: 10,
            sizeOnDisk: 0,
            percentOfTracks: 0,
          },
        })
      ),
      MediaStatus.PROCESSING
    );
    assert.strictEqual(
      getLidarrAlbumMediaStatus(
        fakeLidarrAlbum({
          statistics: {
            trackFileCount: 5,
            trackCount: 10,
            totalTrackCount: 10,
            sizeOnDisk: 500,
            percentOfTracks: 50,
          },
        })
      ),
      MediaStatus.PARTIALLY_AVAILABLE
    );
    assert.strictEqual(
      getLidarrAlbumMediaStatus(fakeLidarrAlbum()),
      MediaStatus.AVAILABLE
    );
  });

  it('resets PROCESSING to UNKNOWN when an album is not in any Lidarr server', async () => {
    const mediaRepository = getRepository(Media);
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'missing-release-group',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneOrFail({
      where: { mbId: 'missing-release-group', mediaType: MediaType.MUSIC },
    });
    assert.strictEqual(updated.status, MediaStatus.UNKNOWN);
  });

  it('keeps AVAILABLE albums available when missing from Lidarr', async () => {
    const mediaRepository = getRepository(Media);
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'available-release-group',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneOrFail({
      where: { mbId: 'available-release-group', mediaType: MediaType.MUSIC },
    });
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
  });

  it('skips orphan cleanup when any Lidarr server has sync disabled', async () => {
    const mediaRepository = getRepository(Media);
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'possibly-on-disabled-server',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([
      { syncEnabled: true, id: 0, hostname: 'server-a' },
      { syncEnabled: false, id: 1, hostname: 'server-b' },
    ]);
    getAlbumsImpl = async () => [];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneOrFail({
      where: {
        mbId: 'possibly-on-disabled-server',
        mediaType: MediaType.MUSIC,
      },
    });
    assert.strictEqual(updated.status, MediaStatus.PROCESSING);
  });

  it('resets PROCESSING to UNKNOWN when an album is unmonitored with no files', async () => {
    const mediaRepository = getRepository(Media);
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'unmonitored-release-group',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        foreignAlbumId: 'unmonitored-release-group',
        monitored: false,
        statistics: {
          trackFileCount: 0,
          trackCount: 10,
          totalTrackCount: 10,
          sizeOnDisk: 0,
          percentOfTracks: 0,
        },
      }),
    ];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneOrFail({
      where: { mbId: 'unmonitored-release-group', mediaType: MediaType.MUSIC },
    });
    assert.strictEqual(updated.status, MediaStatus.UNKNOWN);
  });

  it('marks an unmonitored album with files as AVAILABLE', async () => {
    const mediaRepository = getRepository(Media);

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        id: 526,
        title: 'Greatest Hits',
        foreignAlbumId: 'ba9e0f81-2f31-3b0b-9f56-b178c055d32e',
        monitored: false,
        statistics: {
          trackFileCount: 10,
          trackCount: 10,
          totalTrackCount: 10,
          sizeOnDisk: 100,
          percentOfTracks: 100,
        },
      }),
    ];

    await lidarrScanner.run();

    const media = await mediaRepository.findOneOrFail({
      where: {
        mbId: 'ba9e0f81-2f31-3b0b-9f56-b178c055d32e',
        mediaType: MediaType.MUSIC,
      },
    });
    assert.strictEqual(media.status, MediaStatus.AVAILABLE);
    assert.strictEqual(media.serviceId, 0);
    assert.strictEqual(media.externalServiceId, 526);
  });

  it('stores local album metadata during a Lidarr scan', async () => {
    configureLidarr([
      { syncEnabled: true, name: 'Lidarr MP3', activeProfileName: 'MP3' },
    ]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        id: 527,
        title: 'Fast Local Album',
        foreignAlbumId: 'fast-local-release-group',
        artistName: 'Local Artist',
        releaseDate: '2025-06-07',
        genres: ['Rock', 'Alternative'],
        albumType: 'Album',
      }),
    ];

    await lidarrScanner.run();

    const media = await getRepository(Media).findOneOrFail({
      where: {
        mbId: 'fast-local-release-group',
        mediaType: MediaType.MUSIC,
      },
    });
    const metadata = await getRepository(MediaSearchMetadata).findOneOrFail({
      where: { mediaId: media.id },
    });

    assert.strictEqual(metadata.title, 'Fast Local Album');
    assert.strictEqual(metadata.artist, 'Local Artist');
    assert.strictEqual(metadata.releaseDate, '2025-06-07');
    assert.strictEqual(metadata.genres, 'Rock, Alternative');
    assert.strictEqual(metadata.albumType, 'Album');
    assert.strictEqual(metadata.provider, 'Lidarr MP3');
  });

  it('preserves availability from multiple Lidarr destinations', async () => {
    const mediaRepository = getRepository(Media);
    let scanNumber = 0;

    configureLidarr([
      { id: 0, hostname: 'lidarr-mp3', activeProfileName: 'MP3' },
      { id: 1, hostname: 'lidarr-flac', activeProfileName: 'FLAC' },
    ]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        id: 700 + scanNumber++,
        title: 'Dual Format Album',
        foreignAlbumId: 'dual-format-release-group',
      }),
    ];

    await lidarrScanner.run();

    const media = await mediaRepository.findOneOrFail({
      where: {
        mbId: 'dual-format-release-group',
        mediaType: MediaType.MUSIC,
      },
    });
    assert.deepStrictEqual(media.availableMusicServiceIds, [0, 1]);
    assert.strictEqual(media.serviceId, 1);
  });

  it('removes stale destination availability after every enabled service is scanned', async () => {
    const mediaRepository = getRepository(Media);
    let scanNumber = 0;
    await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'single-format-release-group',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 1,
        externalServiceId: 801,
        availableMusicServiceIds: [0, 1],
      })
    );

    configureLidarr([
      { id: 0, hostname: 'lidarr-mp3', activeProfileName: 'MP3' },
      { id: 1, hostname: 'lidarr-flac', activeProfileName: 'FLAC' },
    ]);
    getAlbumsImpl = async () => {
      scanNumber += 1;
      return scanNumber === 1
        ? []
        : [
            fakeLidarrAlbum({
              id: 801,
              title: 'Single Format Album',
              foreignAlbumId: 'single-format-release-group',
            }),
          ];
    };

    await lidarrScanner.run();

    const media = await mediaRepository.findOneOrFail({
      where: {
        mbId: 'single-format-release-group',
        mediaType: MediaType.MUSIC,
      },
    });
    assert.deepStrictEqual(media.availableMusicServiceIds, [1]);
  });

  it('normalizes MusicBrainz release group IDs before saving scanned albums', async () => {
    const mediaRepository = getRepository(Media);

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        foreignAlbumId: ' RELEASE-GROUP-ID ',
      }),
    ];

    await lidarrScanner.run();

    const media = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC },
    });
    assert.strictEqual(media.length, 1);
    assert.strictEqual(media[0].mbId, 'release-group-id');
  });

  it('updates the requested media through its Lidarr link when the returned MusicBrainz ID differs', async () => {
    const mediaRepository = getRepository(Media);
    const requestedMedia = await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'requested-release-group',
        mediaType: MediaType.MUSIC,
        serviceId: 0,
        externalServiceId: 812,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        id: 812,
        foreignAlbumId: 'lidarr-canonical-release-group',
      }),
    ];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneByOrFail({
      id: requestedMedia.id,
    });
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
    assert.strictEqual(
      await mediaRepository.countBy({ mediaType: MediaType.MUSIC }),
      1
    );
  });

  it('does not orphan a linked in-flight album when Lidarr reports a different MusicBrainz ID', async () => {
    const mediaRepository = getRepository(Media);
    const requestedMedia = await mediaRepository.save(
      new Media({
        tmdbId: 0,
        mbId: 'requested-in-flight-release-group',
        mediaType: MediaType.MUSIC,
        serviceId: 0,
        externalServiceId: 913,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    configureLidarr([{ syncEnabled: true }]);
    getAlbumsImpl = async () => [
      fakeLidarrAlbum({
        id: 913,
        foreignAlbumId: 'lidarr-in-flight-release-group',
        statistics: {
          trackFileCount: 0,
          trackCount: 10,
          totalTrackCount: 10,
          sizeOnDisk: 0,
          percentOfTracks: 0,
        },
      }),
    ];

    await lidarrScanner.run();

    const updated = await mediaRepository.findOneByOrFail({
      id: requestedMedia.id,
    });
    assert.strictEqual(updated.status, MediaStatus.PROCESSING);
  });
});
