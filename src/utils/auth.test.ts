import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAuthenticationError } from './auth';

describe('authentication error detection', () => {
  it('recognizes unauthorized responses from common HTTP client shapes', () => {
    assert.strictEqual(isAuthenticationError({ status: 401 }), true);
    assert.strictEqual(isAuthenticationError({ statusCode: 403 }), true);
    assert.strictEqual(
      isAuthenticationError({ response: { status: 401 } }),
      true
    );
  });

  it('does not treat transient or server failures as logout signals', () => {
    for (const error of [
      { status: 500 },
      { response: { status: 502 } },
      new Error('network unavailable'),
      undefined,
      null,
    ]) {
      assert.strictEqual(isAuthenticationError(error), false);
    }
  });
});
