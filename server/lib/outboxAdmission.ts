import dataSource, { isPgsql } from '@server/datasource';
import AsyncLock from '@server/utils/asyncLock';
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

type AdmissionDataSource = Pick<DataSource, 'transaction'>;

export const OUTBOX_ADMISSION_LOCK_KEY = 'seerr:outbox-admission';

export class OutboxAdmissionCoordinator {
  private readonly localLock = new AsyncLock();

  constructor(
    private readonly source: AdmissionDataSource,
    private readonly postgresEnabled: boolean
  ) {}

  public async run<Entity extends ObjectLiteral, Result>(
    target: EntityTarget<Entity>,
    callback: (repository: Repository<Entity>) => Promise<Result>,
    repository?: Repository<Entity>
  ): Promise<Result> {
    const activeRepository =
      repository?.manager.queryRunner?.isTransactionActive === true
        ? repository
        : undefined;

    if (this.postgresEnabled) {
      if (activeRepository) {
        await this.acquirePostgresLock(activeRepository.manager);
        return callback(activeRepository);
      }

      return this.source.transaction(async (manager) => {
        await this.acquirePostgresLock(manager);
        return callback(manager.getRepository(target));
      });
    }

    return this.localLock.dispatch(OUTBOX_ADMISSION_LOCK_KEY, async () => {
      if (activeRepository) {
        return callback(activeRepository);
      }

      return this.source.transaction((manager) =>
        callback(manager.getRepository(target))
      );
    });
  }

  private async acquirePostgresLock(manager: EntityManager): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [OUTBOX_ADMISSION_LOCK_KEY]
    );
  }
}

const outboxAdmissionCoordinator = new OutboxAdmissionCoordinator(
  dataSource,
  isPgsql
);

export default outboxAdmissionCoordinator;
