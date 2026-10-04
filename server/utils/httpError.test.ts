import axios from 'axios';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getHttpErrorDetails,
  getRetryAfterMs,
  hasHttpStatus,
  isTransientHttpError,
  withTransientHttpRetry,
} from './httpError';

describe('hasHttpStatus', () => {
  it('recognizes structured, wrapped, and textual HTTP statuses', () => {
    assert.equal(hasHttpStatus({ response: { status: 404 } }, 404), true);
    assert.equal(
      hasHttpStatus(
        new Error('outer', {
          cause: Object.assign(
            new Error('Request failed with status code 404'),
            {
              statusCode: 404,
            }
          ),
        }),
        404
      ),
      true
    );
    assert.equal(hasHttpStatus(new Error('404'), 404), true);
    assert.equal(
      hasHttpStatus(new Error('resource id 404 is valid'), 404),
      false
    );
    assert.equal(hasHttpStatus(new Error('status 500'), 404), false);
  });

  it('terminates on circular causes', () => {
    const error = new Error('outer') as Error & { cause?: unknown };
    error.cause = error;
    assert.equal(hasHttpStatus(error, 404), false);
  });
});

describe('HTTP error utilities', () => {
  it('retains Axios status and error code', () => {
    const error = new axios.AxiosError(
      'upstream unavailable',
      'ECONNRESET',
      undefined,
      undefined,
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config: { headers: {} } as never,
        data: undefined,
      }
    );

    assert.deepEqual(getHttpErrorDetails(error), {
      errorMessage: 'upstream unavailable',
      errorCode: 'ECONNRESET',
      status: 503,
      upstreamMessage: 'Service Unavailable',
    });
    assert.equal(isTransientHttpError(error), true);
  });

  it('recognizes transient Axios errors wrapped by a provider', () => {
    const error = new axios.AxiosError(
      'rate limited',
      undefined,
      undefined,
      undefined,
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'retry-after': '1.5' },
        config: { headers: {} } as never,
        data: undefined,
      }
    );
    const wrapped = new Error('provider request failed', { cause: error });

    assert.equal(isTransientHttpError(wrapped), true);
    assert.equal(getHttpErrorDetails(wrapped).status, 429);
    assert.equal(getRetryAfterMs(wrapped), 1500);
  });

  it('does not retry permanent client errors', async () => {
    const error = new axios.AxiosError(
      'not found',
      undefined,
      undefined,
      undefined,
      {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: { headers: {} } as never,
        data: undefined,
      }
    );
    let attempts = 0;

    await assert.rejects(
      withTransientHttpRetry(
        async () => {
          attempts += 1;
          throw error;
        },
        { maxAttempts: 3, delayMs: 0 }
      ),
      error
    );
    assert.equal(attempts, 1);
  });

  it('retries a transient failure once', async () => {
    const error = new axios.AxiosError('socket reset', 'ECONNRESET');
    let attempts = 0;

    const result = await withTransientHttpRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw error;
        }
        return 'ok';
      },
      { delayMs: 0 }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });
});
