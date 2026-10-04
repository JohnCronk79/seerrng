import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';

import animeList from '@server/api/animelist';
import JellyfinAPI, { type JellyfinLibraryItem } from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { setupTestDb } from '@server/test/db';
import { JellyfinScanner } from '.';

setupTestDb();

afterEach(() => {
  mock.restoreAll();
});

it('does not persist catalog results after Jellyfin credentials change', async () => {
  await getRepository(User).update(1, {
    jellyfinUserId: '0123456789abcdef0123456789abcdef',
    jellyfinDeviceId: 'scanner-device',
  });
  const settings = getSettings();
  settings.main = {
    ...settings.main,
    mediaServerType: MediaServerType.JELLYFIN,
  };
  settings.radarr = [];
  settings.sonarr = [];
  settings.jellyfin = {
    ...settings.jellyfin,
    ip: 'jellyfin.local',
    port: 8096,
    useSsl: false,
    apiKey: 'initial-key',
    libraries: [{ id: 'movies', name: 'Movies', enabled: true, type: 'movie' }],
  };
  mock.method(animeList, 'sync', async () => undefined);
  mock.method(JellyfinAPI.prototype, 'getLibraryContents', async () => {
    settings.jellyfin = {
      ...settings.jellyfin,
      apiKey: 'rotated-key',
    };
    return [
      {
        Id: 'jellyfin-992',
        Name: 'Stale Jellyfin Movie',
        Type: 'Movie',
      } as JellyfinLibraryItem,
    ];
  });
  mock.method(
    JellyfinAPI.prototype,
    'getItemData',
    async () =>
      ({
        Id: 'jellyfin-992',
        Name: 'Stale Jellyfin Movie',
        Type: 'Movie',
        ProviderIds: { Tmdb: '992' },
        MediaSources: [
          {
            MediaStreams: [{ Type: 'Video', Width: 1920 }],
          },
        ],
      }) as never
  );

  await new JellyfinScanner().run();

  assert.strictEqual(
    await getRepository(Media).findOne({ where: { tmdbId: 992 } }),
    null
  );
});

it('does not persist catalog results after the owner device changes', async () => {
  const settings = getSettings();
  await getRepository(User).update(1, {
    jellyfinUserId: '0123456789abcdef0123456789abcdef',
    jellyfinDeviceId: 'initial-scanner-device',
  });
  settings.main = {
    ...settings.main,
    mediaServerType: MediaServerType.JELLYFIN,
  };
  settings.radarr = [];
  settings.sonarr = [];
  settings.jellyfin = {
    ...settings.jellyfin,
    ip: 'jellyfin.local',
    port: 8096,
    useSsl: false,
    apiKey: 'stable-key',
    libraries: [{ id: 'movies', name: 'Movies', enabled: true, type: 'movie' }],
  };
  mock.method(animeList, 'sync', async () => undefined);
  mock.method(JellyfinAPI.prototype, 'getLibraryContents', async () => {
    await runUserSecurityMutation(1, () =>
      getRepository(User)
        .update(1, { jellyfinDeviceId: 'rotated-scanner-device' })
        .then(() => undefined)
    );
    return [
      {
        Id: 'jellyfin-994',
        Name: 'Stale Owner Movie',
        Type: 'Movie',
      } as JellyfinLibraryItem,
    ];
  });
  mock.method(
    JellyfinAPI.prototype,
    'getItemData',
    async () =>
      ({
        Id: 'jellyfin-994',
        Name: 'Stale Owner Movie',
        Type: 'Movie',
        ProviderIds: { Tmdb: '994' },
        MediaSources: [{ MediaStreams: [{ Type: 'Video', Width: 1920 }] }],
      }) as never
  );

  await new JellyfinScanner().run();

  assert.strictEqual(
    await getRepository(Media).findOne({ where: { tmdbId: 994 } }),
    null
  );
});
