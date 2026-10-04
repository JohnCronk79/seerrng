import logger from '@server/logger';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  getPendingBackgroundTaskCount,
  trackBackgroundTask,
  waitForBackgroundTasks,
} from './backgroundTasks';

afterEach(async () => {
  await waitForBackgroundTasks();
  mock.restoreAll();
});

describe('background task tracking', () => {
  it('waits for held work and removes it after completion', async () => {
    let release: (() => void) | undefined;
    trackBackgroundTask(
      'held work',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const drain = waitForBackgroundTasks();
    let drained = false;
    void drain.then(() => {
      drained = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(getPendingBackgroundTaskCount(), 1);
    assert.strictEqual(drained, false);
    assert.ok(release);

    release();
    await drain;
    assert.strictEqual(drained, true);
    assert.strictEqual(getPendingBackgroundTaskCount(), 0);
  });

  it('captures failures without rejecting the process drain', async () => {
    const errorMock = mock.method(logger, 'error', () => logger).mock;
    trackBackgroundTask('broken work', async () => {
      throw new Error('background secret failure');
    });

    await waitForBackgroundTasks();

    assert.strictEqual(errorMock.callCount(), 1);
    const logged = JSON.stringify(errorMock.calls[0].arguments);
    assert.match(logged, /broken work/);
    assert.match(logged, /background secret failure/);
  });

  it('also drains work enqueued by a running background task', async () => {
    let childFinished = false;
    trackBackgroundTask('parent work', async () => {
      trackBackgroundTask('child work', async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        childFinished = true;
      });
    });

    await waitForBackgroundTasks();

    assert.strictEqual(childFinished, true);
    assert.strictEqual(getPendingBackgroundTaskCount(), 0);
  });

  it('drains follow-up work deferred to the next event-loop turn', async () => {
    let childFinished = false;
    trackBackgroundTask('deferred parent work', async () => {
      setImmediate(() => {
        trackBackgroundTask('deferred child work', async () => {
          childFinished = true;
        });
      });
    });

    await waitForBackgroundTasks();

    assert.strictEqual(childFinished, true);
    assert.strictEqual(getPendingBackgroundTaskCount(), 0);
  });
});
