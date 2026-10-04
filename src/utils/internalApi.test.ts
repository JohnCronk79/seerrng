import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  INTERNAL_API_HTTP_OPTIONS,
  encodeInternalApiPathSegment,
  getInternalApiBaseUrl,
} from './internalApi';

const originalHost = process.env.HOST;
const originalPort = process.env.PORT;

afterEach(() => {
  process.env.HOST = originalHost;
  process.env.PORT = originalPort;
});

describe('getInternalApiBaseUrl', () => {
  it('uses loopback when HOST is not set', () => {
    delete process.env.HOST;
    delete process.env.PORT;

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:5055');
  });

  it('does not use bind-all hosts for internal requests', () => {
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '8080';

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:8080');

    process.env.HOST = '::';

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:8080');
  });

  it('brackets IPv6 hosts', () => {
    process.env.HOST = 'fd00::1';
    process.env.PORT = '8080';

    assert.equal(getInternalApiBaseUrl(), 'http://[fd00::1]:8080');
  });

  it('rejects host and port values that could change the internal origin', () => {
    process.env.HOST = '127.0.0.1@attacker.example/path';
    process.env.PORT = '5055@attacker.example';

    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:5055');

    process.env.HOST = 'internal.example:8080';
    process.env.PORT = '70000';
    assert.equal(getInternalApiBaseUrl(), 'http://127.0.0.1:5055');
  });
});

describe('internal API request boundaries', () => {
  it('bounds internal SSR requests', () => {
    assert.equal(INTERNAL_API_HTTP_OPTIONS.timeout, 5_000);
    assert.equal(INTERNAL_API_HTTP_OPTIONS.maxContentLength, 16 * 1024 * 1024);
  });

  it('encodes scalar path parameters and rejects arrays', () => {
    assert.equal(encodeInternalApiPathSegment('../settings'), '..%2Fsettings');
    assert.equal(encodeInternalApiPathSegment(123), '123');
    assert.throws(
      () => encodeInternalApiPathSegment(['123']),
      /must be a scalar/
    );
  });
});
