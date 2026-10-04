import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_PUSHOVER_SOUNDS, mapSounds } from './pushover';

describe('Pushover sound response normalization', () => {
  it('caps entries and drops non-string descriptions', () => {
    const sounds = mapSounds(
      Object.fromEntries([
        ['bad', {}],
        ...Array.from({ length: MAX_PUSHOVER_SOUNDS + 100 }, (_, index) => [
          `sound-${index}`,
          `Description ${index}`,
        ]),
      ])
    );

    assert.strictEqual(sounds.length, MAX_PUSHOVER_SOUNDS - 1);
    assert.deepStrictEqual(sounds[0], {
      name: 'sound-0',
      description: 'Description 0',
    });
    assert.deepStrictEqual(mapSounds(null), []);
  });
});
