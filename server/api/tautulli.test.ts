import { AxiosError } from 'axios';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { User } from '@server/entity/User';
import TautulliAPI, {
  isTautulliNoDataError,
  MAX_TAUTULLI_HISTORY_PAGES,
  TAUTULLI_HTTP_LIMITS,
} from './tautulli';

describe('TAUTULLI_HTTP_LIMITS', () => {
  it('bounds outbound Tautulli requests', () => {
    assert.equal(TAUTULLI_HTTP_LIMITS.maxContentLength, 2 * 1024 * 1024);
    assert.equal(TAUTULLI_HTTP_LIMITS.maxBodyLength, 1024);
  });
});

describe('isTautulliNoDataError', () => {
  it('recognizes a wrapped Tautulli 400 response', () => {
    const axiosError = new AxiosError(
      'No stats',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      { status: 400 } as never
    );
    const wrapped = new Error('Tautulli request failed', { cause: axiosError });

    assert.strictEqual(isTautulliNoDataError(wrapped), true);
    assert.strictEqual(isTautulliNoDataError(new Error('offline')), false);
  });
});

describe('Tautulli user history bounds', () => {
  it('stops when the provider repeats the same nonempty page forever', async () => {
    const tautulli = new TautulliAPI({
      hostname: 'tautulli.local',
      port: 8181,
      apiKey: 'test-key',
      useSsl: false,
    });
    let calls = 0;
    Object.defineProperty(tautulli, 'axios', {
      configurable: true,
      value: {
        get: async () => {
          calls += 1;
          return {
            data: {
              response: {
                data: {
                  data: [
                    {
                      media_type: 'movie',
                      rating_key: 123,
                    },
                  ],
                },
              },
            },
          };
        },
      },
    });

    const results = await tautulli.getUserWatchHistory(new User({ plexId: 1 }));

    assert.strictEqual(calls, MAX_TAUTULLI_HISTORY_PAGES);
    assert.strictEqual(results.length, 1);
  });
});
