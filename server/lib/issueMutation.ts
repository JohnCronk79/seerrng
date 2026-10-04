import dataSource, { isPgsql } from '@server/datasource';
import AsyncLock from '@server/utils/asyncLock';
import type { EntityManager } from 'typeorm';

interface IssueMutationDataSource {
  transaction<Result>(
    callback: (manager: EntityManager) => Promise<Result>
  ): Promise<Result>;
}

export class IssueMutationCoordinator {
  private readonly localLock = new AsyncLock();

  constructor(
    private readonly source: IssueMutationDataSource,
    private readonly postgresEnabled: boolean
  ) {}

  public async run<Result>(
    issueId: number,
    callback: (manager: EntityManager) => Promise<Result>
  ): Promise<Result> {
    if (!Number.isSafeInteger(issueId) || issueId <= 0) {
      throw new Error('A valid issue ID is required for an issue mutation.');
    }
    const lockKey = `seerr:issue-mutation:${issueId}`;

    if (this.postgresEnabled) {
      return this.source.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [lockKey]
        );
        return callback(manager);
      });
    }

    return this.localLock.dispatch(lockKey, () =>
      this.source.transaction(callback)
    );
  }
}

const issueMutationCoordinator = new IssueMutationCoordinator(
  dataSource,
  isPgsql
);

export default issueMutationCoordinator;
