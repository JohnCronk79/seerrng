import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_SERVARR_INSTANCES_PER_TYPE,
  assertServarrInstanceCapacity,
  parseKapowarrSettings,
  parseLidarrSettings,
  parseMylarSettings,
  parseSonarrSettings,
  preserveServarrConnectionSecret,
} from './servarrSettings';

describe('Servarr instance capacity', () => {
  it('rejects a full service section with a controlled conflict', () => {
    assert.doesNotThrow(() =>
      assertServarrInstanceCapacity(
        Array.from({ length: MAX_SERVARR_INSTANCES_PER_TYPE - 1 })
      )
    );
    assert.throws(
      () =>
        assertServarrInstanceCapacity(
          Array.from({ length: MAX_SERVARR_INSTANCES_PER_TYPE })
        ),
      (error: Error & { status?: number }) =>
        error.status === 409 && /maximum of 50 instances/i.test(error.message)
    );
  });
});

const baseSettings = {
  name: 'Service',
  hostname: 'service.example',
  port: 8989,
  apiKey: 'api-key',
  useSsl: false,
  activeProfileId: 1,
  activeProfileName: 'Default',
  activeDirectory: '/media',
  tags: [],
  is4k: false,
  isDefault: true,
  syncEnabled: true,
  preventSearch: false,
  tagRequests: false,
  overrideRule: [],
};

describe('preserveServarrConnectionSecret', () => {
  it('restores an existing service API key by bounded numeric id', () => {
    assert.deepStrictEqual(
      preserveServarrConnectionSecret(
        { id: 4, hostname: 'service.example', apiKey: '[REDACTED]' },
        [{ id: 4, apiKey: 'stored-key' }]
      ),
      { id: 4, hostname: 'service.example', apiKey: 'stored-key' }
    );
  });

  it('does not restore a secret without a matching service id', () => {
    const body = { id: 5, apiKey: '[REDACTED]' };
    assert.strictEqual(
      preserveServarrConnectionSecret(body, [{ id: 4, apiKey: 'stored-key' }]),
      body
    );
  });
});

describe('Servarr settings validation', () => {
  it('rejects malformed optional Sonarr profile IDs and booleans', () => {
    const result = parseSonarrSettings({
      ...baseSettings,
      seriesType: 'standard',
      animeSeriesType: 'anime',
      activeAnimeProfileId: '1',
      animeTags: [],
      enableSeasonFolders: true,
      monitorNewItems: 'all',
    });

    assert.deepStrictEqual(result, {
      error: 'activeAnimeProfileId is invalid.',
    });

    const booleanResult = parseSonarrSettings({
      ...baseSettings,
      seriesType: 'standard',
      animeSeriesType: 'anime',
      animeTags: [],
      enableSeasonFolders: 'true',
      monitorNewItems: 'all',
    });

    assert.deepStrictEqual(booleanResult, {
      error: 'enableSeasonFolders must be a boolean.',
    });
  });

  it('rejects malformed optional Lidarr metadata profile IDs', () => {
    assert.deepStrictEqual(
      parseLidarrSettings({
        ...baseSettings,
        activeMetadataProfileId: '1',
      }),
      { error: 'activeMetadataProfileId is invalid.' }
    );
  });
});

const baseCollectorSettings = {
  name: 'Comics Service',
  hostname: 'comics.example',
  port: 8090,
  apiKey: 'api-key',
  useSsl: false,
  tags: [],
  isDefault: true,
  syncEnabled: true,
  preventSearch: false,
};

describe('parseMylarSettings', () => {
  it('accepts a valid instance without a root folder', () => {
    const result = parseMylarSettings(baseCollectorSettings);
    assert.ok('value' in result);
    assert.strictEqual(result.value.rootFolder, undefined);
  });

  it('accepts an optional root folder', () => {
    const result = parseMylarSettings({
      ...baseCollectorSettings,
      rootFolder: '/comics',
    });
    assert.ok('value' in result);
    assert.strictEqual(result.value.rootFolder, '/comics');
  });

  it('rejects a missing required field', () => {
    const withoutName = {
      hostname: baseCollectorSettings.hostname,
      port: baseCollectorSettings.port,
      apiKey: baseCollectorSettings.apiKey,
      useSsl: baseCollectorSettings.useSsl,
      tags: baseCollectorSettings.tags,
      isDefault: baseCollectorSettings.isDefault,
      syncEnabled: baseCollectorSettings.syncEnabled,
      preventSearch: baseCollectorSettings.preventSearch,
    };
    assert.deepStrictEqual(parseMylarSettings(withoutName), {
      error: 'name must be a string.',
    });
  });
});

describe('parseKapowarrSettings', () => {
  it('requires a root folder, unlike Mylar', () => {
    assert.deepStrictEqual(parseKapowarrSettings(baseCollectorSettings), {
      error: 'rootFolder must be a string.',
    });
  });

  it('accepts a valid instance with a root folder', () => {
    const result = parseKapowarrSettings({
      ...baseCollectorSettings,
      rootFolder: '/comics',
    });
    assert.ok('value' in result);
    assert.strictEqual(result.value.rootFolder, '/comics');
  });
});
