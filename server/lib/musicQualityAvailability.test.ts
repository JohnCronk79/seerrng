import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaStatus } from '@server/constants/media';
import { getAvailableMusicServices } from '@server/lib/musicQualityAvailability';

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
