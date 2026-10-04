import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { fetch as UndiciFetch } from 'undici';

import {
  createOidcSafeFetch,
  OIDC_HTTP_MAX_REQUEST_BYTES,
  OIDC_HTTP_MAX_RESPONSE_BYTES,
} from './oidcHttp';

const asUndiciFetch = (request: ReturnType<typeof mock.fn>) =>
  request as unknown as typeof UndiciFetch;

afterEach(() => {
  mock.restoreAll();
  delete process.env.OIDC_ALLOW_PRIVATE_ADDRESSES;
});

describe('oidcSafeFetch', () => {
  it('rejects private provider endpoints before dispatch', async () => {
    const request = mock.fn();
    const oidcSafeFetch = createOidcSafeFetch(asUndiciFetch(request));

    await assert.rejects(
      oidcSafeFetch('http://127.0.0.1/token', {
        body: undefined,
        headers: {},
        method: 'POST',
        redirect: 'manual',
      }),
      /destination is not allowed/
    );
    assert.strictEqual(request.mock.callCount(), 0);
  });

  it('uses a direct dispatcher and converts bounded responses', async () => {
    process.env.OIDC_ALLOW_PRIVATE_ADDRESSES = 'true';
    const request = mock.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        assert.strictEqual(init?.redirect, 'manual');
        assert.ok(init?.signal);
        assert.ok('dispatcher' in (init ?? {}));
        return new Response('{"issuer":"test"}', {
          headers: { 'content-type': 'application/json' },
          status: 200,
          statusText: 'OK',
        });
      }
    );
    const oidcSafeFetch = createOidcSafeFetch(asUndiciFetch(request));

    const response = await oidcSafeFetch('http://127.0.0.1/discovery', {
      body: undefined,
      headers: { accept: 'application/json' },
      method: 'GET',
      redirect: 'manual',
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('content-type'),
      'application/json'
    );
    assert.deepStrictEqual(await response.json(), { issuer: 'test' });
    assert.strictEqual(request.mock.callCount(), 1);
  });

  it('rejects oversized request and response bodies', async () => {
    process.env.OIDC_ALLOW_PRIVATE_ADDRESSES = 'true';
    const request = mock.fn(async () =>
      Promise.resolve(
        new Response(Buffer.alloc(OIDC_HTTP_MAX_RESPONSE_BYTES + 1, 0x78), {
          status: 200,
        })
      )
    );
    const oidcSafeFetch = createOidcSafeFetch(asUndiciFetch(request));
    await assert.rejects(
      oidcSafeFetch('http://127.0.0.1/token', {
        body: 'x'.repeat(OIDC_HTTP_MAX_REQUEST_BYTES + 1),
        headers: {},
        method: 'POST',
        redirect: 'manual',
      }),
      /request exceeds/
    );

    await assert.rejects(
      oidcSafeFetch('http://127.0.0.1/userinfo', {
        body: undefined,
        headers: {},
        method: 'GET',
        redirect: 'manual',
      }),
      /response exceeds/
    );
  });
});
