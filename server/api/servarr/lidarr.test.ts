import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { MAX_SERVARR_LIBRARY_RESPONSE_BYTES } from './base';
import LidarrAPI from './lidarr';

type MockableLidarr = {
  get: (
    endpoint: string,
    config?: {
      maxContentLength?: number;
      params?: Record<string, number>;
    },
    ttl?: number
  ) => Promise<unknown>;
  request: () => Promise<{ data: unknown }>;
};

afterEach(() => {
  mock.restoreAll();
});

describe('Lidarr response normalization', () => {
  it('uses the finite response cap for complete album inventories', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    const get = mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => []
    );

    assert.deepEqual(await api.getAlbums(), []);
    assert.equal(
      get.mock.calls[0].arguments[1]?.maxContentLength,
      MAX_SERVARR_LIBRARY_RESPONSE_BYTES
    );
  });

  it('retrieves a bounded artist ID list for incremental library scans', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    const get = mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [{ id: 10 }, { id: 20 }]
    );

    assert.deepEqual(await api.getArtistIds(), [10, 20]);
    assert.equal(get.mock.calls[0].arguments[0], '/artist');
    assert.equal(
      get.mock.calls[0].arguments[1]?.maxContentLength,
      MAX_SERVARR_LIBRARY_RESPONSE_BYTES
    );
  });

  it('rejects incomplete artist inventories instead of returning a partial scan', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [{ id: 10 }, { id: 'invalid' }]
    );

    await assert.rejects(api.getArtistIds(), /invalid artist record/i);
  });

  it('caps album responses fetched for a single artist', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    const get = mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => []
    );

    assert.deepEqual(await api.getAlbumsByArtist(42), []);
    assert.equal(get.mock.calls[0].arguments[0], '/album');
    assert.deepEqual(get.mock.calls[0].arguments[1]?.params, {
      artistId: 42,
    });
    assert.equal(
      get.mock.calls[0].arguments[1]?.maxContentLength,
      MAX_SERVARR_LIBRARY_RESPONSE_BYTES
    );
  });

  it('returns exact metadata profile records', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [
        null,
        { id: 'bad', name: 'Invalid' },
        {
          id: 1,
          name: 'Standard',
          apiKey: 'provider-secret',
          providerOnly: true,
        },
      ]
    );

    const profiles = await api.getMetadataProfiles();

    assert.deepStrictEqual(profiles, [{ id: 1, name: 'Standard' }]);
  });

  it('returns bounded album history records without unrelated response data', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'request',
      async () => ({
        data: {
          records: [
            null,
            { id: 'bad', albumId: 4 },
            {
              id: 7,
              albumId: 4,
              eventType: 'grabbed',
              date: '2026-09-10T09:42:53Z',
              downloadId: 'download-7',
              data: { apiKey: 'must-not-leak' },
            },
          ],
        },
      })
    );

    assert.deepStrictEqual(await api.getHistory(), [
      {
        id: 7,
        albumId: 4,
        eventType: 'grabbed',
        date: '2026-09-10T09:42:53Z',
        downloadId: 'download-7',
      },
    ]);
  });

  it('returns only valid track availability fields', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [
        null,
        { id: 'bad' },
        {
          id: 7,
          albumId: 4,
          title: 'Track',
          trackNumber: '1',
          absoluteTrackNumber: 1,
          mediumNumber: 1,
          hasFile: true,
          trackFileId: 9,
          foreignRecordingId: 'ABC-123',
          apiKey: 'must-not-leak',
        },
      ]
    );

    assert.deepStrictEqual(await api.getTracks({ albumId: 4 }), [
      {
        id: 7,
        albumId: 4,
        title: 'Track',
        trackNumber: '1',
        absoluteTrackNumber: 1,
        mediumNumber: 1,
        hasFile: true,
        trackFileId: 9,
        foreignRecordingId: 'abc-123',
      },
    ]);
  });
});
