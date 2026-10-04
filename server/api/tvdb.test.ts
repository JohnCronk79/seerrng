import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import Tvdb, { sanitizeTvdbLoginResponse, tvdbTokenNeedsRefresh } from './tvdb';

const resetTvdbSingleton = () => {
  const tvdb = Tvdb as unknown as {
    instance?: Tvdb;
    initialization?: Promise<Tvdb>;
  };
  tvdb.instance = undefined;
  tvdb.initialization = undefined;
};

afterEach(() => {
  resetTvdbSingleton();
  mock.restoreAll();
});

const encodePayload = (payload: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('tvdbTokenNeedsRefresh', () => {
  it('keeps tokens that expire outside the refresh window', () => {
    const now = 1_700_000_000;
    const token = encodePayload({ exp: now + 700_000 });

    assert.equal(tvdbTokenNeedsRefresh(token, now), false);
  });

  it('refreshes missing, malformed, and soon-expiring tokens', () => {
    const now = 1_700_000_000;

    assert.equal(tvdbTokenNeedsRefresh(undefined, now), true);
    assert.equal(tvdbTokenNeedsRefresh('not-a-jwt', now), true);
    assert.equal(tvdbTokenNeedsRefresh('header.not-json.sig', now), true);
    assert.equal(tvdbTokenNeedsRefresh(encodePayload({}), now), true);
    assert.equal(
      tvdbTokenNeedsRefresh(encodePayload({ exp: now + 60 }), now),
      true
    );
  });

  it('refreshes oversized tokens before decoding payloads', () => {
    const oversizedPayload = 'x'.repeat(5 * 1024);

    assert.equal(tvdbTokenNeedsRefresh(`header.${oversizedPayload}.sig`), true);
    assert.equal(tvdbTokenNeedsRefresh('x'.repeat(9 * 1024)), true);
  });
});

describe('sanitizeTvdbLoginResponse', () => {
  it('returns only a bounded token', () => {
    assert.deepStrictEqual(
      sanitizeTvdbLoginResponse({ token: 'token', providerOnly: true }),
      { token: 'token' }
    );
    assert.throws(
      () => sanitizeTvdbLoginResponse({ token: 'x'.repeat(8 * 1024 + 1) }),
      /invalid login response/
    );
    assert.throws(
      () => sanitizeTvdbLoginResponse({ token: '' }),
      /invalid login response/
    );
  });
});

describe('Tvdb.getInstance', () => {
  it('shares login initialization across concurrent callers', async () => {
    let release: (() => void) | undefined;
    let loginCalls = 0;
    mock.method(Tvdb.prototype, 'login', async () => {
      loginCalls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { token: 'token' };
    });

    const first = Tvdb.getInstance();
    const second = Tvdb.getInstance();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(loginCalls, 1);
    assert.ok(release);
    release();
    const [firstInstance, secondInstance] = await Promise.all([first, second]);
    assert.equal(firstInstance, secondInstance);
  });

  it('retries initialization after login fails', async () => {
    let loginCalls = 0;
    mock.method(Tvdb.prototype, 'login', async () => {
      loginCalls += 1;
      if (loginCalls === 1) {
        throw new Error('login failed');
      }
      return { token: 'token' };
    });

    await assert.rejects(Tvdb.getInstance(), /login failed/);
    const recovered = await Tvdb.getInstance();

    assert.ok(recovered instanceof Tvdb);
    assert.equal(loginCalls, 2);
  });
});
