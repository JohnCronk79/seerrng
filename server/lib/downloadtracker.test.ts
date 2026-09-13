import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import RadarrAPI from '@server/api/servarr/radarr';
import {
  DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
  DownloadTracker,
  hasSameServarrDownloadAuthority,
  isMatchingReadarrDownloadServer,
} from '@server/lib/downloadtracker';
import { getSettings } from '@server/lib/settings';

it('bounds queue hydration per service family', () => {
  assert.strictEqual(DOWNLOAD_TRACKER_SERVER_CONCURRENCY, 5);
});

describe('DownloadTracker Bookshelf queues', () => {
  it('does not treat ebook and audiobook Bookshelf configs as duplicate queue sources', () => {
    const baseServer = {
      hostname: 'bookshelf.local',
      port: 8787,
      baseUrl: '',
    };

    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer, serviceType: 'ebook' },
        { ...baseServer, serviceType: 'ebook' }
      ),
      true
    );
    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer, serviceType: 'ebook' },
        { ...baseServer, serviceType: 'audiobook' }
      ),
      false
    );
    assert.strictEqual(
      isMatchingReadarrDownloadServer(
        { ...baseServer },
        { ...baseServer, serviceType: 'ebook' }
      ),
      true
    );
  });
});

describe('DownloadTracker Lidarr history', () => {
  it('finds the newest request-scoped album event after a queue item disappears', () => {
    const tracker = new DownloadTracker();
    Object.assign(tracker as unknown as Record<string, unknown>, {
      lidarrHistory: {
        2: [
          {
            id: 3,
            albumId: 11,
            eventType: 'downloadFailed',
            date: '2026-09-10T09:44:00Z',
            downloadId: 'failed-download',
          },
          {
            id: 2,
            albumId: 11,
            eventType: 'grabbed',
            date: '2026-09-10T09:43:00Z',
            downloadId: 'grabbed-download',
          },
          {
            id: 1,
            albumId: 11,
            eventType: 'grabbed',
            date: '2026-09-10T08:00:00Z',
            downloadId: 'old-download',
          },
        ],
      },
    });

    assert.deepStrictEqual(
      tracker.getMusicHistoryEvidence(2, 11, new Date('2026-09-10T09:42:00Z')),
      {
        stage: 'failed',
        observedAt: new Date('2026-09-10T09:44:00Z'),
        downloadId: 'failed-download',
      }
    );
    assert.equal(
      tracker.getMusicHistoryEvidence(2, 11, new Date('2026-09-10T09:45:00Z')),
      undefined
    );
  });
});

describe('DownloadTracker credential snapshots', () => {
  const server = {
    id: 7,
    name: 'Radarr',
    hostname: 'radarr.local',
    port: 7878,
    apiKey: 'first-key',
    useSsl: false,
    baseUrl: '',
    activeProfileId: 1,
    activeProfileName: 'HD',
    activeDirectory: '/movies',
    tags: [],
    is4k: false,
    isDefault: true,
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
  };

  it('rejects snapshots after credentials, destinations, or sync authority change', () => {
    assert.strictEqual(hasSameServarrDownloadAuthority(server, server), true);
    assert.strictEqual(
      hasSameServarrDownloadAuthority(
        { ...server, apiKey: 'rotated-key' },
        server
      ),
      false
    );
    assert.strictEqual(
      hasSameServarrDownloadAuthority(
        { ...server, hostname: 'replacement.local' },
        server
      ),
      false
    );
    assert.strictEqual(
      hasSameServarrDownloadAuthority(
        { ...server, syncEnabled: false },
        server
      ),
      false
    );
  });

  it('treats omitted Bookshelf type as ebook but separates audiobooks', () => {
    assert.strictEqual(
      hasSameServarrDownloadAuthority(
        { ...server, serviceType: 'ebook' },
        server
      ),
      true
    );
    assert.strictEqual(
      hasSameServarrDownloadAuthority(
        { ...server, serviceType: 'audiobook' },
        server
      ),
      false
    );
  });
});

describe('DownloadTracker update lifecycle', () => {
  it('continues polling remaining configured instances when one fails', async (t) => {
    const settings = getSettings();
    const originalRadarr = settings.radarr;
    const originalSonarr = settings.sonarr;
    const originalLidarr = settings.lidarr;
    const originalReadarr = settings.readarr;
    const baseRadarr = {
      id: 1,
      name: 'Failing Radarr',
      hostname: 'radarr-one.local',
      port: 7878,
      apiKey: 'first-key',
      useSsl: false,
      baseUrl: '',
      activeProfileId: 1,
      activeProfileName: 'HD',
      activeDirectory: '/movies',
      minimumAvailability: 'released',
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
    };
    settings.radarr = [
      baseRadarr,
      {
        ...baseRadarr,
        id: 2,
        name: 'Healthy Radarr',
        hostname: 'radarr-two.local',
        apiKey: 'second-key',
        isDefault: false,
      },
    ];
    settings.sonarr = [];
    settings.lidarr = [];
    settings.readarr = [];

    let queueCalls = 0;
    t.mock.method(
      RadarrAPI.prototype,
      'refreshMonitoredDownloads',
      async () => undefined
    );
    t.mock.method(RadarrAPI.prototype, 'getHistory', async () => []);
    t.mock.method(RadarrAPI.prototype, 'getQueue', async () => {
      queueCalls += 1;
      if (queueCalls === 1) {
        throw new Error('First Radarr unavailable');
      }
      return [
        {
          movieId: 202,
          size: 100,
          title: 'Healthy download',
          sizeleft: 50,
          timeleft: '5 minutes',
          estimatedCompletionTime: '2026-09-12T12:00:00Z',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          downloadId: 'healthy-download',
          protocol: 'usenet',
          downloadClient: 'SABnzbd',
          indexer: 'test',
          id: 202,
        },
      ];
    });

    const tracker = new DownloadTracker();
    try {
      await tracker.updateDownloads();
      assert.strictEqual(queueCalls, 2);
      assert.deepStrictEqual(tracker.getMovieProgress(1, 202), []);
      assert.strictEqual(tracker.getMovieProgress(2, 202).length, 1);
    } finally {
      settings.radarr = originalRadarr;
      settings.sonarr = originalSonarr;
      settings.lidarr = originalLidarr;
      settings.readarr = originalReadarr;
    }
  });

  it('coalesces overlapping queue refreshes', async () => {
    const tracker = new DownloadTracker();
    let calls = 0;
    let release: (() => void) | undefined;
    const heldUpdate = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const immediateUpdate = async () => {
      calls += 1;
    };
    Object.assign(tracker as unknown as Record<string, unknown>, {
      updateRadarrDownloads: heldUpdate,
      updateSonarrDownloads: immediateUpdate,
      updateLidarrDownloads: immediateUpdate,
      updateReadarrDownloads: immediateUpdate,
    });

    const first = tracker.updateDownloads();
    const overlapping = tracker.updateDownloads();

    assert.strictEqual(overlapping, first);
    assert.strictEqual(calls, 4);
    assert.ok(release);

    release();
    await first;
    assert.strictEqual(calls, 4);
  });

  it('does not let an older queue update repopulate a completed reset', async () => {
    const tracker = new DownloadTracker();
    let release: (() => void) | undefined;
    const heldUpdate = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(tracker as unknown as Record<string, unknown>, {
        radarrServers: {
          1: [
            {
              mediaType: 'movie',
              externalId: 99,
              size: 1,
              sizeLeft: 1,
              status: 'downloading',
              timeLeft: '1 minute',
              estimatedCompletionTime: new Date(),
              title: 'Held item',
              downloadId: 'held',
            },
          ],
        },
      });
    };
    Object.assign(tracker as unknown as Record<string, unknown>, {
      updateRadarrDownloads: heldUpdate,
      updateSonarrDownloads: async () => undefined,
      updateLidarrDownloads: async () => undefined,
      updateReadarrDownloads: async () => undefined,
    });

    const update = tracker.updateDownloads();
    const reset = tracker.resetDownloadTracker();
    let resetFinished = false;
    void reset.then(() => {
      resetFinished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(resetFinished, false);
    assert.ok(release);

    release();
    await Promise.all([update, reset]);
    assert.deepStrictEqual(tracker.getMovieProgress(1, 99), []);
  });
});
