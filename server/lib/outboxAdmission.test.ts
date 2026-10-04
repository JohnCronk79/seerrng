import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OUTBOX_ADMISSION_LOCK_KEY,
  OutboxAdmissionCoordinator,
} from '@server/lib/outboxAdmission';
import type { EntityManager, Repository } from 'typeorm';

class TestEntity {
  id: number;
}

const createRepository = (
  manager: Partial<EntityManager>
): Repository<TestEntity> => ({ manager }) as unknown as Repository<TestEntity>;

describe('OutboxAdmissionCoordinator', () => {
  it('uses the caller transaction for PostgreSQL advisory admission', async () => {
    const queries: { sql: string; parameters: unknown[] }[] = [];
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ sql, parameters });
      },
    } as unknown as EntityManager;
    const repository = createRepository(manager);
    let ownTransactions = 0;
    const coordinator = new OutboxAdmissionCoordinator(
      {
        transaction: async () => {
          ownTransactions += 1;
          throw new Error('must not create another transaction');
        },
      } as never,
      true
    );

    const result = await coordinator.run(
      TestEntity,
      async (lockedRepository) => {
        assert.strictEqual(lockedRepository, repository);
        return 'inserted';
      },
      repository
    );

    assert.strictEqual(result, 'inserted');
    assert.strictEqual(ownTransactions, 0);
    assert.strictEqual(queries.length, 1);
    assert.match(queries[0].sql, /pg_advisory_xact_lock/);
    assert.deepStrictEqual(queries[0].parameters, [OUTBOX_ADMISSION_LOCK_KEY]);
  });

  it('holds standalone PostgreSQL admission inside its insertion transaction', async () => {
    const events: string[] = [];
    const manager = {
      query: async () => {
        events.push('lock');
      },
      getRepository: () => {
        events.push('repository');
        return createRepository(manager as EntityManager);
      },
    } as unknown as EntityManager;
    const coordinator = new OutboxAdmissionCoordinator(
      {
        transaction: async (callback: (value: EntityManager) => unknown) => {
          events.push('begin');
          const result = await callback(manager);
          events.push('commit');
          return result;
        },
      } as never,
      true
    );

    await coordinator.run(TestEntity, async () => {
      events.push('insert');
      return undefined;
    });

    assert.deepStrictEqual(events, [
      'begin',
      'lock',
      'repository',
      'insert',
      'commit',
    ]);
  });

  it('serializes standalone SQLite admission callbacks', async () => {
    const manager = {
      getRepository: () => createRepository(manager as EntityManager),
    } as unknown as EntityManager;
    const coordinator = new OutboxAdmissionCoordinator(
      {
        transaction: async (callback: (value: EntityManager) => unknown) =>
          callback(manager),
      } as never,
      false
    );
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        coordinator.run(TestEntity, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active -= 1;
        })
      )
    );

    assert.strictEqual(peak, 1);
  });
});
