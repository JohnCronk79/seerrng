import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import axios from 'axios';
import {
  fetchSafeRemoteImage,
  MAX_SAFE_REMOTE_IMAGE_BYTES,
} from './safeRemoteImage';

describe('fetchSafeRemoteImage', () => {
  afterEach(() => mock.restoreAll());

  it('uses bounded direct connections and returns a normalized raster image', async () => {
    const get = mock.method(axios, 'get', async () => ({
      data: Buffer.from('image'),
      headers: { 'content-type': 'image/jpeg; charset=binary' },
    }));

    const result = await fetchSafeRemoteImage('https://8.8.8.8/cover.jpg');

    assert.deepStrictEqual(result, {
      imageBuffer: Buffer.from('image'),
      contentType: 'image/jpeg',
    });
    const options = get.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.strictEqual(options.responseType, 'arraybuffer');
    assert.strictEqual(options.maxContentLength, MAX_SAFE_REMOTE_IMAGE_BYTES);
    assert.strictEqual(options.maxBodyLength, MAX_SAFE_REMOTE_IMAGE_BYTES);
    assert.strictEqual(options.timeout, 10_000);
    assert.strictEqual(options.proxy, false);
    assert.strictEqual(typeof options.lookup, 'function');
    assert.strictEqual(typeof options.beforeRedirect, 'function');
  });

  it('rejects private targets before sending a request', async () => {
    const get = mock.method(axios, 'get', async () => ({
      data: Buffer.from('image'),
      headers: { 'content-type': 'image/jpeg' },
    }));

    await assert.rejects(
      fetchSafeRemoteImage('http://127.0.0.1/private.jpg'),
      /not safe to request/
    );
    assert.strictEqual(get.mock.calls.length, 0);
  });

  it('blocks redirects to private addresses', async () => {
    const get = mock.method(axios, 'get', async () => ({
      data: Buffer.from('image'),
      headers: { 'content-type': 'image/jpeg' },
    }));
    await fetchSafeRemoteImage('https://8.8.8.8/cover.jpg');

    const options = get.mock.calls[0].arguments[1] as {
      beforeRedirect: (
        options: Record<string, unknown>,
        response?: unknown,
        request?: { url?: unknown }
      ) => void;
    };
    assert.throws(
      () =>
        options.beforeRedirect(
          { protocol: 'http:', hostname: '127.0.0.1' },
          undefined,
          { url: 'https://8.8.8.8/cover.jpg' }
        ),
      /private address/
    );
  });

  it('rejects active SVG responses', async () => {
    mock.method(axios, 'get', async () => ({
      data: Buffer.from('<svg></svg>'),
      headers: { 'content-type': 'image/svg+xml' },
    }));

    await assert.rejects(
      fetchSafeRemoteImage('https://8.8.8.8/cover.svg'),
      /supported raster image/
    );
  });

  it('rejects responses that exceed the byte limit', async () => {
    mock.method(axios, 'get', async () => ({
      data: Buffer.alloc(MAX_SAFE_REMOTE_IMAGE_BYTES + 1),
      headers: { 'content-type': 'image/jpeg' },
    }));

    await assert.rejects(
      fetchSafeRemoteImage('https://8.8.8.8/oversized.jpg'),
      /maximum allowed size/
    );
  });
});
