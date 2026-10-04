import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import axios, { type AxiosRequestConfig } from 'axios';
import webpush from 'web-push';
import { WEB_PUSH_DELIVERY_CONCURRENCY, sendWebPushRequest } from './webpush';

describe('sendWebPushRequest', () => {
  it('bounds concurrent push delivery fanout', () => {
    assert.equal(WEB_PUSH_DELIVERY_CONCURRENCY, 10);
  });

  it('uses socket-level destination checks and rejects cross-origin redirects', async () => {
    mock.method(webpush, 'generateRequestDetails', () => ({
      endpoint: 'https://push.example.com/subscription',
      method: 'POST' as const,
      headers: { Authorization: 'vapid-secret' },
      body: Buffer.from('encrypted-payload'),
    }));

    let requestConfig: AxiosRequestConfig | undefined;
    mock.method(axios, 'request', async (config: AxiosRequestConfig) => {
      requestConfig = config;
      return { data: undefined };
    });

    await sendWebPushRequest(
      {
        endpoint: 'https://push.example.com/subscription',
        keys: { auth: 'auth', p256dh: 'p256dh' },
      },
      Buffer.from('payload')
    );

    assert.strictEqual(requestConfig?.method, 'POST');
    assert.strictEqual(typeof requestConfig?.lookup, 'function');
    assert.strictEqual(typeof requestConfig?.beforeRedirect, 'function');
    assert.strictEqual(requestConfig?.proxy, false);
    assert.strictEqual(requestConfig?.httpAgent, false);
    assert.strictEqual(requestConfig?.httpsAgent, false);

    assert.throws(
      () =>
        requestConfig?.beforeRedirect?.(
          {
            href: 'https://other.example/redirect',
            protocol: 'https:',
            hostname: 'other.example',
            headers: { Authorization: 'vapid-secret' },
          },
          { headers: {}, statusCode: 307 },
          {
            url: 'https://push.example.com/subscription',
            method: 'POST',
            headers: {},
          }
        ),
      (error: NodeJS.ErrnoException) => error.code === 'EACCES'
    );
  });
});
