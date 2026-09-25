import { getRepository } from '@server/datasource';
import { ScheduledJobLease } from '@server/entity/ScheduledJobLease';
import { randomUUID } from 'node:crypto';
import { In, MoreThan } from 'typeorm';

export const SCHEDULED_JOB_LEASE_MS = 5 * 60 * 1000;
const MAX_SCHEDULED_JOB_NAME_LENGTH = 128;

export type ScheduledJobLeaseResult<T> =
  { acquired: false } | { acquired: true; value: T };

export class ScheduledJobLeaseManager {
  private validateName(name: string): void {
    if (!name || name.length > MAX_SCHEDULED_JOB_NAME_LENGTH) {
      throw new Error('Scheduled job lease name is invalid.');
    }
  }

  private async claim(name: string, owner: string): Promise<boolean> {
    this.validateName(name);
    const repository = getRepository(ScheduledJobLease);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SCHEDULED_JOB_LEASE_MS);
    await repository
      .createQueryBuilder()
      .insert()
      .into(ScheduledJobLease)
      .values({ name, owner, expiresAt })
      .orIgnore()
      .execute();
    const result = await repository
      .createQueryBuilder()
      .update(ScheduledJobLease)
      .set({ owner, expiresAt })
      .where('name = :name', { name })
      .andWhere('(owner = :owner OR "expiresAt" < :now)', {
        owner,
        now,
      })
      .execute();
    return result.affected === 1;
  }

  private async renew(name: string, owner: string): Promise<void> {
    const result = await getRepository(ScheduledJobLease).update(
      { name, owner },
      { expiresAt: new Date(Date.now() + SCHEDULED_JOB_LEASE_MS) }
    );
    if (result.affected !== 1) {
      throw new Error(`Scheduled job lease was lost: ${name}`);
    }
  }

  private async release(name: string, owner: string): Promise<void> {
    const result = await getRepository(ScheduledJobLease).delete({
      name,
      owner,
    });
    if (result.affected !== 1) {
      throw new Error(`Scheduled job lease was lost: ${name}`);
    }
  }

  public async getActiveLeaseNames(names: string[]): Promise<Set<string>> {
    const uniqueNames = [...new Set(names)];
    uniqueNames.forEach((name) => this.validateName(name));
    if (uniqueNames.length === 0) {
      return new Set();
    }

    const leases = await getRepository(ScheduledJobLease).find({
      select: { name: true },
      where: {
        name: In(uniqueNames),
        expiresAt: MoreThan(new Date()),
      },
    });
    return new Set(leases.map((lease) => lease.name));
  }

  public async run<T>(
    name: string,
    task: () => T | Promise<T>
  ): Promise<ScheduledJobLeaseResult<T>> {
    const owner = randomUUID();
    if (!(await this.claim(name, owner))) {
      return { acquired: false };
    }

    let heartbeatError: unknown;
    let pendingRenewal = Promise.resolve();
    const renew = (): void => {
      pendingRenewal = pendingRenewal
        .then(() => this.renew(name, owner))
        .catch((error) => {
          heartbeatError ??= error;
        });
    };
    const timer = setInterval(
      renew,
      Math.max(1_000, Math.floor(SCHEDULED_JOB_LEASE_MS / 3))
    );
    timer.unref();

    try {
      const value = await task();
      await pendingRenewal;
      if (heartbeatError) {
        throw heartbeatError;
      }
      await this.renew(name, owner);
      return { acquired: true, value };
    } finally {
      clearInterval(timer);
      await pendingRenewal;
      await this.release(name, owner);
    }
  }
}

const scheduledJobLeaseManager = new ScheduledJobLeaseManager();
export default scheduledJobLeaseManager;
