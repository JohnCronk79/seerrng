import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AllSettings } from '@server/lib/settings';
import enableDefaultHttpAuth from './0015_enable_default_http_auth';

const makeSettings = (tls: Record<string, unknown>): AllSettings =>
  ({
    network: { tls },
    migrations: [],
  }) as unknown as AllSettings;

describe('0015_enable_default_http_auth', () => {
  it('enables HTTP authentication for existing disabled-TLS defaults', () => {
    const migrated = enableDefaultHttpAuth(
      makeSettings({
        mode: 'disabled',
        allowHttpAuth: false,
        httpAuthAcknowledged: false,
      })
    );

    assert.equal(migrated.network.tls.allowHttpAuth, true);
    assert.equal(migrated.network.tls.httpAuthAcknowledged, true);
    assert.deepEqual(migrated.migrations, ['0015_enable_default_http_auth']);
  });

  it('does not enable HTTP authentication for built-in TLS modes', () => {
    const migrated = enableDefaultHttpAuth(
      makeSettings({ mode: 'self-signed', allowHttpAuth: false })
    );

    assert.equal(migrated.network.tls.allowHttpAuth, false);
    assert.deepEqual(migrated.migrations, ['0015_enable_default_http_auth']);
  });

  it('is idempotent after recording the migration', () => {
    const settings = makeSettings({
      mode: 'disabled',
      allowHttpAuth: true,
      httpAuthAcknowledged: true,
    });
    settings.migrations = ['0015_enable_default_http_auth'];

    assert.strictEqual(enableDefaultHttpAuth(settings), settings);
  });
});
