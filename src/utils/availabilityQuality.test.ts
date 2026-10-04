import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaStatus } from '@server/constants/media';
import { matchesAvailableQuality } from './availabilityQuality';

test('video quality filtering accepts complete and partial scanned availability', () => {
  assert.equal(
    matchesAvailableQuality(
      {
        mediaInfo: {
          status: MediaStatus.PARTIALLY_AVAILABLE,
          status4k: MediaStatus.AVAILABLE,
        },
      },
      'hd'
    ),
    true
  );
  assert.equal(
    matchesAvailableQuality(
      {
        mediaInfo: {
          status: MediaStatus.UNKNOWN,
          status4k: MediaStatus.PARTIALLY_AVAILABLE,
        },
      },
      '4k'
    ),
    true
  );
  assert.equal(
    matchesAvailableQuality(
      {
        mediaInfo: {
          status: MediaStatus.PENDING,
          status4k: MediaStatus.UNKNOWN,
        },
      },
      'hd'
    ),
    false
  );
});

test('music quality filtering uses the separately exposed Lidarr qualities', () => {
  const album: { availableQualities: ('MP3' | 'FLAC')[] } = {
    availableQualities: ['MP3', 'FLAC'],
  };

  assert.equal(matchesAvailableQuality(album, 'mp3'), true);
  assert.equal(matchesAvailableQuality(album, 'flac'), true);
  assert.equal(matchesAvailableQuality({}, 'flac'), false);
});
