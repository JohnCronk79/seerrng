import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAuthAccountAdmissionResource,
  runAuthAccountAdmission,
} from './authAccountAdmission';

describe('auth account admission', () => {
  it('hashes canonical identities without retaining account data', () => {
    const resource = getAuthAccountAdmissionResource(
      'email',
      'private@example.com'
    );

    assert.match(resource, /^auth-account:email:[a-f0-9]{16}$/);
    assert.doesNotMatch(resource, /private|example/);
  });

  it('serializes matching identities locally', async () => {
    const resource = getAuthAccountAdmissionResource('plex', '1234');
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let secondEntered = false;

    const first = runAuthAccountAdmission([resource], async () => {
      firstStarted();
      await firstHeld;
    });
    await firstStartedPromise;
    const second = runAuthAccountAdmission([resource], async () => {
      secondEntered = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(secondEntered, false);

    releaseFirst();
    await Promise.all([first, second]);
    assert.strictEqual(secondEntered, true);
  });

  it('rejects empty and unrelated resources', async () => {
    assert.throws(
      () => getAuthAccountAdmissionResource('email', ''),
      /non-empty auth account identity/
    );
    assert.throws(
      () => runAuthAccountAdmission([], async () => undefined),
      /valid auth account resource/
    );
    assert.throws(
      () =>
        runAuthAccountAdmission(
          ['user-security:user:1'],
          async () => undefined
        ),
      /valid auth account resource/
    );
  });
});
