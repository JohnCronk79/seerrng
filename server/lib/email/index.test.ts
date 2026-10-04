import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMAIL_TRANSPORT_TIMEOUT_OPTIONS } from '.';

describe('EMAIL_TRANSPORT_TIMEOUT_OPTIONS', () => {
  it('bounds SMTP connection lifetimes', () => {
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.connectionTimeout, 10_000);
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.greetingTimeout, 10_000);
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.socketTimeout, 30_000);
  });
});
