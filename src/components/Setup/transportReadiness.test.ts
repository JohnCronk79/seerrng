import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBrowserTransportReady } from './transportReadiness';

const status = (
  overrides: Partial<Parameters<typeof isBrowserTransportReady>[0]> = {}
) => ({
  mode: 'disabled' as const,
  httpAuthAllowed: false,
  pendingRestart: false,
  ...overrides,
});

describe('isBrowserTransportReady', () => {
  it('rejects direct HTTP when the explicit fallback is disabled', () => {
    assert.equal(isBrowserTransportReady(status(), false), false);
  });

  it('accepts direct HTTP only when the fallback is active', () => {
    assert.equal(
      isBrowserTransportReady(status({ httpAuthAllowed: true }), false),
      true
    );
  });

  it('accepts HTTPS supplied by a reverse proxy', () => {
    assert.equal(isBrowserTransportReady(status(), true), true);
  });

  it('requires HTTPS for built-in TLS modes', () => {
    assert.equal(
      isBrowserTransportReady(status({ mode: 'self-signed' }), false),
      false
    );
    assert.equal(
      isBrowserTransportReady(status({ mode: 'provided' }), true),
      true
    );
  });

  it('rejects direct HTTP while a saved choice awaits restart', () => {
    assert.equal(
      isBrowserTransportReady(
        status({ httpAuthAllowed: true, pendingRestart: true }),
        false
      ),
      false
    );
    assert.equal(
      isBrowserTransportReady(
        status({ mode: 'self-signed', pendingRestart: true }),
        true
      ),
      true
    );
  });
});
