import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EntityManager } from 'typeorm';
import { IssueMutationCoordinator } from './issueMutation';

describe('IssueMutationCoordinator', () => {
  it('rejects invalid issue IDs before opening a transaction', async () => {
    let transactionCalls = 0;
    const source = {
      transaction: async <T>(
        callback: (manager: EntityManager) => Promise<T>
      ) => {
        transactionCalls += 1;
        return callback({} as EntityManager);
      },
    };
    const coordinator = new IssueMutationCoordinator(source, false);

    await assert.rejects(
      coordinator.run(Number.NaN, async () => undefined),
      /valid issue ID/i
    );
    assert.strictEqual(transactionCalls, 0);
  });

  it('serializes same-issue SQLite mutations through transaction completion', async () => {
    let active = 0;
    let maximumActive = 0;
    const source = {
      transaction: async <T>(
        callback: (manager: EntityManager) => Promise<T>
      ) => callback({} as EntityManager),
    };
    const coordinator = new IssueMutationCoordinator(source, false);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        coordinator.run(42, async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setImmediate(resolve));
          active -= 1;
        })
      )
    );

    assert.strictEqual(maximumActive, 1);
  });

  it('uses a transaction-scoped PostgreSQL advisory lock per issue', async () => {
    const calls: { sql: string; parameters: unknown[] }[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ sql, parameters });
      },
    } as EntityManager;
    const source = {
      transaction: async <T>(
        callback: (manager: EntityManager) => Promise<T>
      ) => callback(manager),
    };
    const coordinator = new IssueMutationCoordinator(source, true);

    await coordinator.run(7, async (activeManager) => {
      assert.strictEqual(activeManager, manager);
    });

    assert.match(calls[0].sql, /pg_advisory_xact_lock/);
    assert.deepStrictEqual(calls[0].parameters, ['seerr:issue-mutation:7']);
  });
});
