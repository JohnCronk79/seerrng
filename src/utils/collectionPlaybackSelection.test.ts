import {
  orderCollectionPartsOldestFirst,
  reconcileCollectionPlaybackSelection,
} from '@app/utils/collectionPlaybackSelection';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('collection playback selection', () => {
  it('orders dated members oldest first and leaves undated members last', () => {
    const parts = [
      { id: 3 },
      { id: 2, releaseDate: '2005-06-15' },
      { id: 1, releaseDate: '1999-01-01' },
      { id: 4, releaseDate: 'not-a-date' },
    ];

    assert.deepStrictEqual(
      orderCollectionPartsOldestFirst(parts).map((part) => part.id),
      [1, 2, 3, 4]
    );
  });

  it('defaults to every available member in display order', () => {
    assert.deepStrictEqual(
      reconcileCollectionPlaybackSelection([], [8, 3, 5], false),
      [8, 3, 5]
    );
  });

  it('preserves an intentionally empty selection after availability refreshes', () => {
    assert.deepStrictEqual(
      reconcileCollectionPlaybackSelection([], [8, 3, 5], true),
      []
    );
  });

  it('removes unavailable members without repopulating a manual selection', () => {
    assert.deepStrictEqual(
      reconcileCollectionPlaybackSelection([8, 3], [3, 5], true),
      [3]
    );
  });
});
