import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DataSource, QueryRunner } from 'typeorm';
import { RequestAdmissionCoordinator } from './requestAdmission';

type Waiter = { owner: symbol; resolve: () => void };

class FakeAdvisoryDatabase {
  private readonly owners = new Map<string, symbol>();
  private readonly waiters = new Map<string, Waiter[]>();
  public connections = 0;

  public createDataSource(): Pick<DataSource, 'createQueryRunner'> {
    return {
      createQueryRunner: () => {
        const owner = Symbol('connection');
        const held = new Set<string>();
        const runner = {
          isTransactionActive: false,
          connect: async () => {
            this.connections += 1;
          },
          startTransaction: async () => {
            runner.isTransactionActive = true;
          },
          commitTransaction: async () => {
            this.releaseAll(held, owner);
            runner.isTransactionActive = false;
          },
          rollbackTransaction: async () => {
            this.releaseAll(held, owner);
            runner.isTransactionActive = false;
          },
          release: async () => {
            this.releaseAll(held, owner);
            runner.isTransactionActive = false;
          },
          query: async (sql: string, parameters?: unknown[]) => {
            const key = String(parameters?.[0]);
            if (sql.includes('pg_advisory_xact_lock(')) {
              await this.acquire(key, owner);
              held.add(key);
              return [{ pg_advisory_xact_lock: null }];
            }
            throw new Error(`Unexpected query: ${sql}`);
          },
        };
        return runner as unknown as QueryRunner;
      },
    };
  }

  private releaseAll(held: Set<string>, owner: symbol): void {
    for (const key of held) {
      this.release(key, owner);
    }
    held.clear();
  }

  private acquire(key: string, owner: symbol): Promise<void> {
    if (!this.owners.has(key)) {
      this.owners.set(key, owner);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.set(key, [
        ...(this.waiters.get(key) ?? []),
        { owner, resolve },
      ]);
    });
  }

  private release(key: string, owner: symbol): boolean {
    if (this.owners.get(key) !== owner) {
      return false;
    }

    const [next, ...remaining] = this.waiters.get(key) ?? [];
    if (next) {
      this.owners.set(key, next.owner);
      if (remaining.length) {
        this.waiters.set(key, remaining);
      } else {
        this.waiters.delete(key);
      }
      next.resolve();
    } else {
      this.owners.delete(key);
    }
    return true;
  }
}

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('RequestAdmissionCoordinator', () => {
  it('serializes matching resources across coordinator instances', async () => {
    const database = new FakeAdvisoryDatabase();
    const first = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const second = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let secondEntered = false;

    const firstRun = first.run(['user:1', 'media:1'], async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    const secondRun = second.run(['media:1', 'user:2'], async () => {
      secondEntered = true;
    });

    await nextTurn();
    assert.equal(secondEntered, false);
    releaseFirst.resolve();
    await Promise.all([firstRun, secondRun]);
    assert.equal(secondEntered, true);
  });

  it('allows unrelated resources to proceed concurrently', async () => {
    const database = new FakeAdvisoryDatabase();
    const first = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const second = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const release = deferred();
    let entered = 0;
    const callback = async () => {
      entered += 1;
      if (entered === 2) {
        release.resolve();
      }
      await release.promise;
    };

    await Promise.all([
      first.run(['user:1', 'media:1'], callback),
      second.run(['user:2', 'media:2'], callback),
    ]);
    assert.equal(entered, 2);
  });

  it('releases resources after a protected callback fails', async () => {
    const database = new FakeAdvisoryDatabase();
    const first = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true
    );
    const second = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true
    );

    await assert.rejects(
      first.run(['user:1'], async () => {
        throw new Error('request failed');
      }),
      /request failed/
    );
    assert.equal(
      await second.run(['user:1'], async () => 'retried'),
      'retried'
    );
  });

  it('acquires nested canonical resources on the same connection', async () => {
    const database = new FakeAdvisoryDatabase();
    const first = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const second = new RequestAdmissionCoordinator(
      database.createDataSource(),
      true,
      2
    );
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let secondEntered = false;

    const firstRun = first.run(['user:1', 'raw:release:1'], () =>
      first.run(['canonical:release-group:1'], async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
      })
    );
    await firstEntered.promise;
    const secondRun = second.run(['user:2', 'raw:release:2'], () =>
      second.run(['canonical:release-group:1'], async () => {
        secondEntered = true;
      })
    );

    await nextTurn();
    assert.equal(secondEntered, false);
    assert.equal(database.connections, 2);
    releaseFirst.resolve();
    await Promise.all([firstRun, secondRun]);
    assert.equal(secondEntered, true);
    assert.equal(database.connections, 2);
  });
});
