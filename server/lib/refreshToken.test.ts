import PlexTvAPI from '@server/api/plextv';
import * as datasource from '@server/datasource';
import refreshToken from '@server/lib/refreshToken';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

afterEach(() => {
  mock.restoreAll();
});

describe('Plex token refresh lifecycle', () => {
  it('does not finish the job before token pings settle', async () => {
    const queryBuilder = {
      select() {
        return this;
      },
      addSelect() {
        return this;
      },
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      take() {
        return this;
      },
      async getMany() {
        return [{ id: 1, plexToken: 'plex-token', displayName: 'Admin' }];
      },
    };
    mock.method(datasource, 'getRepository', () => ({
      createQueryBuilder: () => queryBuilder,
      findOne: async () => ({ id: 1, plexToken: 'plex-token' }),
    }));
    let release: (() => void) | undefined;
    const pingMock = mock.method(
      PlexTvAPI.prototype,
      'pingToken',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const run = refreshToken.run();
    let finished = false;
    void run.then(() => {
      finished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(pingMock.mock.callCount(), 1);
    assert.strictEqual(finished, false);
    assert.ok(release);

    release();
    await run;
    assert.strictEqual(finished, true);
  });

  it('does not ping a token removed after the job enumerates users', async () => {
    const queryBuilder = {
      select() {
        return this;
      },
      addSelect() {
        return this;
      },
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      take() {
        return this;
      },
      async getMany() {
        return [{ id: 2, plexToken: 'retired-token' }];
      },
    };
    mock.method(datasource, 'getRepository', () => ({
      createQueryBuilder: () => queryBuilder,
      findOne: async () => ({ id: 2, plexToken: null }),
    }));
    const pingMock = mock.method(
      PlexTvAPI.prototype,
      'pingToken',
      async () => undefined
    );

    await refreshToken.run();

    assert.strictEqual(pingMock.mock.callCount(), 0);
  });
});
