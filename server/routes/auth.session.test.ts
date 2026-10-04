import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { establishAuthenticatedSession } from './auth';

describe('establishAuthenticatedSession', () => {
  it('regenerates the session before storing the authenticated user id', async () => {
    let regenerated = false;
    const req: {
      session: {
        userId?: number;
        credentialVersion?: number;
        regenerate(callback: (error?: Error) => void): void;
      };
    } = {
      session: {
        userId: 99,
        regenerate(callback: (error?: Error) => void) {
          regenerated = true;
          delete this.userId;
          delete this.credentialVersion;
          callback();
        },
      },
    };

    await establishAuthenticatedSession(req as never, 7, 1234);

    assert.equal(regenerated, true);
    assert.equal(req.session.userId, 7);
    assert.equal(req.session.credentialVersion, 1234);
  });

  it('rejects when session regeneration fails', async () => {
    const req: {
      session: {
        userId?: number;
        credentialVersion?: number;
        regenerate(callback: (error?: Error) => void): void;
      };
    } = {
      session: {
        userId: 99,
        regenerate(callback: (error?: Error) => void) {
          callback(new Error('store unavailable'));
        },
      },
    };

    await assert.rejects(
      establishAuthenticatedSession(req as never, 7),
      /store unavailable/
    );
    assert.equal(req.session.userId, 99);
  });

  it('rejects instead of reporting a sessionless login as successful', async () => {
    await assert.rejects(
      establishAuthenticatedSession({ session: undefined } as never, 7),
      /Session is unavailable/
    );
  });
});
