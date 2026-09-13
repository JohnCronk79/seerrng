import { resolveCanonicalPlaybackSelection } from '@app/utils/playbackSelection';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('canonical playback selection', () => {
  it('plays a non-empty selection in original catalog order', () => {
    assert.deepStrictEqual(
      resolveCanonicalPlaybackSelection(
        ['s2e3', 's2e4', 's2e12'],
        ['s2e12', 's2e3']
      ),
      ['s2e3', 's2e12']
    );
  });

  it('defaults an empty selection to every item in original order', () => {
    assert.deepStrictEqual(
      resolveCanonicalPlaybackSelection(['track-1', 'track-2'], []),
      ['track-1', 'track-2']
    );
  });

  it('drops identifiers that are not in the current catalog', () => {
    assert.deepStrictEqual(
      resolveCanonicalPlaybackSelection([8, 3, 5], [99, 5, 8]),
      [8, 5]
    );
  });
});
