import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapWithConcurrency } from './concurrency';

describe('browser mapWithConcurrency', () => {
  it('preserves order while bounding active work', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];

    const resultPromise = mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return item * 2;
    });

    await Promise.resolve();
    assert.strictEqual(active, 2);
    while (releases.length > 0 || active > 0) {
      releases.shift()?.();
      await Promise.resolve();
    }

    assert.deepStrictEqual(await resultPromise, [2, 4, 6, 8]);
    assert.strictEqual(maximumActive, 2);
  });

  it('rejects invalid concurrency values', async () => {
    await assert.rejects(
      mapWithConcurrency([1], 0, async (item) => item),
      /positive integer/
    );
  });
});
