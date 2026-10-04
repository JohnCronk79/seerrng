import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  captureConfigurationAuthority,
  ConfigurationAuthorityChangedError,
  runWithConfigurationAdmission,
  runWithConfigurationSnapshot,
} from './configurationAdmission';
import { getSettings } from './settings';

it('serializes matching singleton configuration operations', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let matchingEntered = false;
  let unrelatedEntered = false;
  const first = runWithConfigurationAdmission('tautulli', async () => {
    entered();
    await held;
  });
  await enteredPromise;
  const matching = runWithConfigurationAdmission('tautulli', async () => {
    matchingEntered = true;
  });
  const unrelated = runWithConfigurationAdmission('plex', async () => {
    unrelatedEntered = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.strictEqual(matchingEntered, false);
  assert.strictEqual(unrelatedEntered, true);
  release();
  await Promise.all([first, matching, unrelated]);
  assert.strictEqual(matchingEntered, true);
});

it('rejects immutable configuration snapshots after authority changes', async () => {
  const settings = getSettings();
  const previous = structuredClone(settings.jellyfin);
  const snapshot = captureConfigurationAuthority('jellyfin');
  settings.jellyfin = { ...settings.jellyfin, apiKey: 'rotated-key' };

  try {
    await assert.rejects(
      runWithConfigurationSnapshot(snapshot, async () => undefined),
      ConfigurationAuthorityChangedError
    );
  } finally {
    settings.jellyfin = previous;
  }
});

it('does not invalidate Plex authority when only last-scan timestamps change', async () => {
  const settings = getSettings();
  const previous = structuredClone(settings.plex);
  settings.plex = {
    ...settings.plex,
    libraries: [
      { id: '1', name: 'Movies', enabled: true, type: 'movie', lastScan: 1 },
    ],
  };
  const snapshot = captureConfigurationAuthority('plex');
  settings.plex = {
    ...settings.plex,
    libraries: settings.plex.libraries.map((library) => ({
      ...library,
      lastScan: 2,
    })),
  };

  try {
    let invoked = false;
    await runWithConfigurationSnapshot(snapshot, async () => {
      invoked = true;
    });
    assert.strictEqual(invoked, true);
  } finally {
    settings.plex = previous;
  }
});
