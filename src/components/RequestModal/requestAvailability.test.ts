import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBookFormatCoveredByActiveRequest,
  isMusicDestinationAvailable,
} from '@app/components/RequestModal/requestAvailability';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';

test('music availability follows the selected Lidarr destination', () => {
  const media = {
    status: MediaStatus.AVAILABLE,
    serviceId: 1,
    requests: [
      {
        serviceTargets: [
          {
            serviceType: 'lidarr' as const,
            format: 'music' as const,
            serverId: 2,
            status: MediaStatus.AVAILABLE,
          },
        ],
      },
    ],
  };

  assert.equal(isMusicDestinationAvailable(media, 1), true);
  assert.equal(isMusicDestinationAvailable(media, 2), true);
  assert.equal(isMusicDestinationAvailable(media, 3), false);
});

test('an available FLAC destination does not block an MP3 request', () => {
  const media = {
    status: MediaStatus.AVAILABLE,
    serviceId: 2,
  };

  assert.equal(isMusicDestinationAvailable(media, 2), true);
  assert.equal(isMusicDestinationAvailable(media, 1), false);
});

test('an available MP3 destination does not block a FLAC request', () => {
  const media = {
    status: MediaStatus.AVAILABLE,
    serviceId: 1,
  };

  assert.equal(isMusicDestinationAvailable(media, 1), true);
  assert.equal(isMusicDestinationAvailable(media, 2), false);
});

test('legacy music availability remains global when no service identity exists', () => {
  assert.equal(
    isMusicDestinationAvailable({ status: MediaStatus.AVAILABLE }, 2),
    true
  );
  assert.equal(
    isMusicDestinationAvailable({ status: MediaStatus.PROCESSING }, 2),
    false
  );
});

test('completed destination availability remains exact after requests leave the active payload', () => {
  const media = { status: MediaStatus.AVAILABLE, serviceId: 1 };

  assert.equal(isMusicDestinationAvailable(media, 2, [{ serverId: 2 }]), true);
  assert.equal(isMusicDestinationAvailable(media, 3, [{ serverId: 2 }]), false);
});

test('book request coverage blocks only active overlapping formats', () => {
  const requests = [
    {
      status: MediaRequestStatus.PENDING,
      bookFormat: 'audiobook' as const,
    },
    {
      status: MediaRequestStatus.COMPLETED,
      bookFormat: 'ebook' as const,
    },
  ];

  assert.equal(isBookFormatCoveredByActiveRequest(requests, 'audiobook'), true);
  assert.equal(isBookFormatCoveredByActiveRequest(requests, 'ebook'), false);
  assert.equal(isBookFormatCoveredByActiveRequest(requests, 'both'), true);
});

test('both-format book requests cover each individual format', () => {
  const requests = [
    {
      status: MediaRequestStatus.APPROVED,
      bookFormat: 'both' as const,
    },
  ];

  assert.equal(isBookFormatCoveredByActiveRequest(requests, 'ebook'), true);
  assert.equal(isBookFormatCoveredByActiveRequest(requests, 'audiobook'), true);
});
