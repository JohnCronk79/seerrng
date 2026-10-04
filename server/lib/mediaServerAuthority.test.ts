import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaServerType } from '@server/constants/server';
import type { AllSettings } from '@server/lib/settings';
import { getJellyfinAuthAuthorityKey } from './mediaServerAuthority';

describe('media-server authentication authority', () => {
  const settings = {
    main: {
      mediaServerType: MediaServerType.JELLYFIN,
      mediaServerLogin: true,
    },
    jellyfin: {
      ip: 'jellyfin.local',
      port: 8096,
      useSsl: false,
      urlBase: '',
      serverId: 'server-one',
      apiKey: 'first-key',
    },
  } as Pick<AllSettings, 'main' | 'jellyfin'>;

  it('changes when the identity realm, destination, or credential changes', () => {
    const initial = getJellyfinAuthAuthorityKey(settings);

    assert.notStrictEqual(
      getJellyfinAuthAuthorityKey({
        ...settings,
        jellyfin: { ...settings.jellyfin, serverId: 'server-two' },
      }),
      initial
    );
    assert.notStrictEqual(
      getJellyfinAuthAuthorityKey({
        ...settings,
        jellyfin: { ...settings.jellyfin, ip: 'replacement.local' },
      }),
      initial
    );
    assert.notStrictEqual(
      getJellyfinAuthAuthorityKey({
        ...settings,
        jellyfin: { ...settings.jellyfin, apiKey: 'rotated-key' },
      }),
      initial
    );
  });
});
