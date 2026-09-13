import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaStatus } from '@server/constants/media';
import {
  getAvailableMusicQualities,
  getAvailableMusicServices,
} from '@server/lib/musicQualityAvailability';

test('music quality availability combines scanned and completed target copies', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      { status: MediaStatus.AVAILABLE, serviceId: 1 },
      [
        {
          serviceTargets: [
            {
              serviceType: 'lidarr',
              format: 'music',
              serverId: 2,
              status: MediaStatus.AVAILABLE,
            },
          ],
        },
      ],
      [
        { id: 1, name: 'Lidarr MP3', activeProfileName: 'MP3' },
        { id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' },
      ]
    ),
    [
      { serverId: 1, quality: 'MP3' },
      { serverId: 2, quality: 'FLAC' },
    ]
  );
});

test('music quality availability preserves every scanned Lidarr destination', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      {
        status: MediaStatus.AVAILABLE,
        serviceId: 2,
        availableMusicServiceIds: [0, 2],
      },
      [],
      [
        { id: 0, name: 'Lidarr MP3', activeProfileName: 'MP3' },
        { id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' },
      ]
    ),
    [
      { serverId: 0, quality: 'MP3' },
      { serverId: 2, quality: 'FLAC' },
    ]
  );
});

test('music quality labels are normalized and ordered for title cards', () => {
  assert.deepStrictEqual(
    getAvailableMusicQualities(
      {
        status: MediaStatus.AVAILABLE,
        availableMusicServiceIds: [7, 3],
      },
      [],
      [
        { id: 7, name: 'Lossless', activeProfileName: 'FLAC Lossless' },
        { id: 3, name: 'Portable', activeProfileName: 'MP3 320' },
      ]
    ),
    ['MP3', 'FLAC']
  );
});

test('an explicit empty scanned destination list does not revive the legacy service', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      {
        status: MediaStatus.AVAILABLE,
        serviceId: 1,
        availableMusicServiceIds: [],
      },
      [],
      [{ id: 1, name: 'Lidarr FLAC', activeProfileName: 'FLAC' }]
    ),
    []
  );
});
