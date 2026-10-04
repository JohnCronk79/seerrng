import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import AsyncLock from './asyncLock';

describe('AsyncLock', () => {
  it('supports object-prototype key names without deadlocking', async () => {
    const lock = new AsyncLock();

    assert.equal(
      await lock.dispatch('__proto__', async () => 'completed'),
      'completed'
    );
    assert.equal(
      await lock.dispatch('constructor', async () => 'completed again'),
      'completed again'
    );
  });

  it('serializes the same key while allowing return values', async () => {
    const lock = new AsyncLock();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lock.dispatch('user:1', async () => {
      events.push('first:start');
      await firstMayFinish;
      events.push('first:end');
      return 1;
    });
    const second = lock.dispatch('user:1', async () => {
      events.push('second:start');
      return 2;
    });

    await Promise.resolve();
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
  });

  it('releases a key when a callback throws', async () => {
    const lock = new AsyncLock();

    await assert.rejects(
      lock.dispatch('user:1', async () => {
        throw new Error('failed');
      }),
      /failed/
    );
    assert.equal(await lock.dispatch('user:1', async () => 2), 2);
  });
});
