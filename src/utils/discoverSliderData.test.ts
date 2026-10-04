import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWatchProviderIds } from './discoverSliderData';

describe('parseWatchProviderIds', () => {
  it('rejects malformed legacy IDs and preserves unique valid order', () => {
    assert.deepStrictEqual(
      parseWatchProviderIds('8||nope|0|-1|8|9|1000000001|10'),
      [8, 9, 10]
    );
    assert.deepStrictEqual(parseWatchProviderIds(undefined), []);
  });

  it('bounds legacy provider fan-out', () => {
    assert.deepStrictEqual(
      parseWatchProviderIds(
        Array.from({ length: 101 }, (_, index) => index + 1).join('|')
      ),
      Array.from({ length: 100 }, (_, index) => index + 1)
    );
  });
});
