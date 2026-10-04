import assert from 'node:assert/strict';
import { it } from 'node:test';

import { runDiscoverSliderMutation } from './discoverSliderMutation';

it('serializes discovery slider collection mutations', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let secondEntered = false;
  const first = runDiscoverSliderMutation(async () => {
    entered();
    await held;
  });
  await enteredPromise;
  const second = runDiscoverSliderMutation(async () => {
    secondEntered = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.strictEqual(secondEntered, false);
  release();
  await Promise.all([first, second]);
  assert.strictEqual(secondEntered, true);
});
