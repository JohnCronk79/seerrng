import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import PlexCompanionAPI from './plexcompanion';

describe('Plex Companion playback', () => {
  it('sends the complete play-queue context to the selected player', async () => {
    const companion = new PlexCompanionAPI({
      clientUrl: 'http://192.168.10.9:32400',
      clientIdentifier: 'tv-client-id',
      plexToken: 'token',
    });
    let endpoint = '';
    let options: { params?: Record<string, unknown> } = {};
    Object.defineProperty(companion, 'get', {
      configurable: true,
      value: async (
        requestedEndpoint: string,
        requestedOptions: typeof options
      ) => {
        endpoint = requestedEndpoint;
        options = requestedOptions;
        return {};
      },
    });

    await companion.playMedia({
      server: {
        name: 'Plex',
        ip: '192.168.10.9',
        port: 32400,
        useSsl: false,
        libraries: [],
      },
      machineIdentifier: 'server-id',
      ratingKey: 'movie-id',
      playQueueId: 42,
      mediaType: 'video',
    });

    assert.strictEqual(endpoint, '/player/playback/playMedia');
    assert.deepStrictEqual(options.params, {
      machineIdentifier: 'server-id',
      address: '192.168.10.9',
      port: 32400,
      protocol: 'http',
      key: '/library/metadata/movie-id',
      path: 'http://192.168.10.9:32400/library/metadata/movie-id',
      offset: 0,
      commandID: 1,
      playQueueID: 42,
      containerKey: '/playQueues/42?window=200&own=1',
      providerIdentifier: 'com.plexapp.plugins.library',
      type: 'video',
      token: 'token',
    });
  });

  it('maps Plex audio play queues to the Companion music type', async () => {
    const companion = new PlexCompanionAPI({
      clientUrl: 'http://192.168.10.9:32400',
      clientIdentifier: 'tv-client-id',
      plexToken: 'token',
    });
    let options: { params?: Record<string, unknown> } = {};
    Object.defineProperty(companion, 'get', {
      configurable: true,
      value: async (
        _requestedEndpoint: string,
        requestedOptions: typeof options
      ) => {
        options = requestedOptions;
        return {};
      },
    });

    await companion.playMedia({
      server: {
        name: 'Plex',
        ip: '192.168.10.9',
        port: 32400,
        useSsl: false,
        libraries: [],
      },
      machineIdentifier: 'server-id',
      ratingKey: 'track-id',
      playQueueId: 43,
      mediaType: 'audio',
    });

    assert.strictEqual(options.params?.type, 'music');
    assert.strictEqual(options.params?.key, '/library/metadata/track-id');
    assert.strictEqual(options.params?.playQueueID, 43);
  });
});
