import assert from 'node:assert/strict';
import { it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { setupTestDb } from '@server/test/db';
import {
  captureMediaServerUserAuthority,
  MediaServerUserAuthorityChangedError,
  runWithMediaServerUserAuthority,
} from './mediaServerUserAuthority';
import { runUserSecurityMutation } from './userSecurityMutation';

setupTestDb();

it('rejects owner authority snapshots after Plex tokens rotate', async () => {
  const repository = getRepository(User);
  const snapshot = await captureMediaServerUserAuthority(1, 'plex');
  await runUserSecurityMutation(1, () =>
    repository
      .update(1, { plexToken: 'rotated-owner-token' })
      .then(() => undefined)
  );

  await assert.rejects(
    runWithMediaServerUserAuthority(snapshot, async () => undefined),
    MediaServerUserAuthorityChangedError
  );
});

it('rejects owner authority snapshots after Jellyfin device identity changes', async () => {
  const repository = getRepository(User);
  await runUserSecurityMutation(1, () =>
    repository
      .update(1, {
        jellyfinUserId: '0123456789abcdef0123456789abcdef',
        jellyfinDeviceId: 'initial-device',
      })
      .then(() => undefined)
  );
  const snapshot = await captureMediaServerUserAuthority(1, 'jellyfin');
  await runUserSecurityMutation(1, () =>
    repository
      .update(1, { jellyfinDeviceId: 'rotated-device' })
      .then(() => undefined)
  );

  await assert.rejects(
    runWithMediaServerUserAuthority(snapshot, async () => undefined),
    MediaServerUserAuthorityChangedError
  );
});
