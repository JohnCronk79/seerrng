import dataSource, { isPgsql, POSTGRES_POOL_SIZE } from '@server/datasource';
import AsyncLock from '@server/utils/asyncLock';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSource, QueryRunner } from 'typeorm';

type AdmissionDataSource = Pick<DataSource, 'createQueryRunner'>;

const MAX_ADMISSION_CONNECTION_SLOTS = 8;

type AdmissionContext = {
  runner: QueryRunner;
  acquired: string[];
  acquiredSet: Set<string>;
};

const hashSlot = (value: string, slotCount: number): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % slotCount;
};

export class RequestAdmissionCoordinator {
  private readonly slots = new AsyncLock();
  private readonly context = new AsyncLocalStorage<AdmissionContext>();

  constructor(
    private readonly source: AdmissionDataSource,
    private readonly enabled: boolean,
    private readonly slotCount = 1
  ) {}

  public async run<T>(
    resourceKeys: string[],
    callback: () => Promise<T>
  ): Promise<T> {
    if (!this.enabled) {
      return callback();
    }

    const keys = [...new Set(resourceKeys)].sort();
    const existingContext = this.context.getStore();
    if (existingContext) {
      await this.acquireLocks(existingContext, keys);
      return callback();
    }

    const slot = hashSlot(keys.join('\0'), Math.max(1, this.slotCount));

    return this.slots.dispatch(slot, async () => {
      const runner = this.source.createQueryRunner();
      const admissionContext: AdmissionContext = {
        runner,
        acquired: [],
        acquiredSet: new Set(),
      };

      await runner.connect();
      try {
        await runner.startTransaction();
        await this.acquireLocks(admissionContext, keys);
        const result = await this.context.run(admissionContext, callback);
        await runner.commitTransaction();
        return result;
      } catch (error) {
        try {
          if (runner.isTransactionActive) {
            await runner.rollbackTransaction();
          }
        } catch {
          // Releasing the connection below forces PostgreSQL to discard any
          // remaining transaction and its transaction-scoped advisory locks.
        }
        throw error;
      } finally {
        await runner.release();
      }
    });
  }

  private async acquireLocks(
    context: AdmissionContext,
    keys: string[]
  ): Promise<void> {
    for (const key of keys) {
      if (context.acquiredSet.has(key)) {
        continue;
      }
      await context.runner.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key]
      );
      context.acquired.push(key);
      context.acquiredSet.add(key);
    }
  }
}

const requestAdmissionCoordinator = new RequestAdmissionCoordinator(
  dataSource,
  isPgsql,
  Math.min(MAX_ADMISSION_CONNECTION_SLOTS, POSTGRES_POOL_SIZE - 1)
);

export default requestAdmissionCoordinator;
