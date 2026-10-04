import { getRepository } from '@server/datasource';
import { ScheduledJobLease } from '@server/entity/ScheduledJobLease';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScheduledJobLeaseManager } from './jobLease';

setupTestDb();

describe('ScheduledJobLeaseManager', () => {
  it('allows only one instance to run the same job', async () => {
    const firstManager = new ScheduledJobLeaseManager();
    const secondManager = new ScheduledJobLeaseManager();
    let release: (() => void) | undefined;
    let firstRuns = 0;
    let secondRuns = 0;
    const first = firstManager.run('scheduled-job:test', async () => {
      firstRuns += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    for (let attempt = 0; attempt < 100 && !release; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(release);

    const competing = await secondManager.run(
      'scheduled-job:test',
      async () => {
        secondRuns += 1;
      }
    );
    assert.deepStrictEqual(competing, { acquired: false });
    assert.strictEqual(firstRuns, 1);
    assert.strictEqual(secondRuns, 0);

    release();
    assert.deepStrictEqual(await first, { acquired: true, value: undefined });

    const afterRelease = await secondManager.run(
      'scheduled-job:test',
      async () => {
        secondRuns += 1;
      }
    );
    assert.deepStrictEqual(afterRelease, {
      acquired: true,
      value: undefined,
    });
    assert.strictEqual(secondRuns, 1);
  });

  it('does not treat overlapping runs on one manager as the same owner', async () => {
    const manager = new ScheduledJobLeaseManager();
    let release: (() => void) | undefined;
    let overlappingRuns = 0;
    const first = manager.run('scheduled-job:same-manager', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    for (let attempt = 0; attempt < 100 && !release; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(release);

    const overlapping = await manager.run(
      'scheduled-job:same-manager',
      async () => {
        overlappingRuns += 1;
      }
    );
    assert.deepStrictEqual(overlapping, { acquired: false });
    assert.strictEqual(overlappingRuns, 0);

    release();
    assert.deepStrictEqual(await first, { acquired: true, value: undefined });
  });

  it('recovers an expired lease left by a dead instance', async () => {
    await getRepository(ScheduledJobLease).save(
      new ScheduledJobLease({
        name: 'scheduled-job:expired',
        owner: 'dead-instance',
        expiresAt: new Date(Date.now() - 1),
      })
    );
    let runs = 0;

    const result = await new ScheduledJobLeaseManager().run(
      'scheduled-job:expired',
      async () => {
        runs += 1;
        return 42;
      }
    );

    assert.deepStrictEqual(result, { acquired: true, value: 42 });
    assert.strictEqual(runs, 1);
    assert.strictEqual(await getRepository(ScheduledJobLease).count(), 0);
  });

  it('releases a lease when the task fails', async () => {
    const firstManager = new ScheduledJobLeaseManager();
    const secondManager = new ScheduledJobLeaseManager();

    await assert.rejects(
      firstManager.run('scheduled-job:failing', async () => {
        throw new Error('task failed');
      }),
      /task failed/
    );

    const result = await secondManager.run(
      'scheduled-job:failing',
      async () => 'recovered'
    );
    assert.deepStrictEqual(result, {
      acquired: true,
      value: 'recovered',
    });
  });

  it('rejects invalid lease names before persistence', async () => {
    await assert.rejects(
      new ScheduledJobLeaseManager().run('', async () => undefined),
      /lease name is invalid/
    );
    await assert.rejects(
      new ScheduledJobLeaseManager().run(
        'x'.repeat(129),
        async () => undefined
      ),
      /lease name is invalid/
    );
    assert.strictEqual(await getRepository(ScheduledJobLease).count(), 0);
  });
});
