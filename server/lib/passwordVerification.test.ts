import { BoundedTaskQueueFullError } from '@server/utils/concurrency';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBoundedPasswordVerifier } from './passwordVerification';

describe('createBoundedPasswordVerifier', () => {
  it('bounds queued password hashing work', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const verifier = createBoundedPasswordVerifier(
      async (password) => {
        if (password === 'first') {
          await firstGate;
        }
        return true;
      },
      { concurrency: 1, maxQueued: 1 }
    );

    const first = verifier('first', 'hash');
    const second = verifier('second', 'hash');
    await assert.rejects(verifier('third', 'hash'), BoundedTaskQueueFullError);

    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  });
});
