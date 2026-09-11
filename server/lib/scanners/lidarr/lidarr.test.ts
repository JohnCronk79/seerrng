import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getLidarrAlbumMediaStatus } from '@server/lib/musicAvailability';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

let getAlbumsImpl: () => Promise<LidarrAlbum[]> = async () => [];
Object.defineProperty(LidarrAPI.prototype, 'getAlbums', {
  set() {},
  get() {
    return async () => getAlbumsImpl();
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
