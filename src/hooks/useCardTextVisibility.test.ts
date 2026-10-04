import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CardTextVisibilityMutationState } from './cardTextVisibilityMutation';
import { getCardTextVisibilityStorageKey } from './useCardTextVisibility';

describe('card text visibility storage partition', () => {
  it('uses distinct keys for authenticated users and anonymous sessions', () => {
    assert.strictEqual(
      getCardTextVisibilityStorageKey(1),
      'seerr.cardTextVisibility:1'
    );
    assert.strictEqual(
      getCardTextVisibilityStorageKey(2),
      'seerr.cardTextVisibility:2'
    );
    assert.strictEqual(
      getCardTextVisibilityStorageKey(undefined),
      'seerr.cardTextVisibility:anonymous'
    );
    assert.strictEqual(
      getCardTextVisibilityStorageKey(0),
      'seerr.cardTextVisibility:anonymous'
    );
  });
});

describe('CardTextVisibilityMutationState', () => {
  it('derives rapid mutations from the latest optimistic value', () => {
    const state = new CardTextVisibilityMutationState();
    state.synchronize('user:1', { movie: 'hover', tv: 'hover' });

    state.begin('movie', 'always');
    const second = state.begin('tv', 'always');

    assert.deepStrictEqual(second.next, {
      movie: 'always',
      tv: 'always',
    });
  });

  it('allows only the latest mutation to roll browser state back', () => {
    const state = new CardTextVisibilityMutationState();
    state.synchronize('user:1', { movie: 'hover', tv: 'hover' });

    const first = state.begin('movie', 'always');
    const second = state.begin('tv', 'always');

    assert.strictEqual(state.rollback(first), undefined);
    assert.deepStrictEqual(state.rollback(second), {
      movie: 'always',
      tv: 'hover',
    });
  });

  it('invalidates pending mutations when the active user changes', () => {
    const state = new CardTextVisibilityMutationState();
    state.synchronize('user:1', { movie: 'hover' });
    const mutation = state.begin('movie', 'always');

    state.synchronize('user:2', { movie: 'hover' });

    assert.strictEqual(state.isCurrent(mutation), false);
    assert.strictEqual(state.rollback(mutation), undefined);
  });
});
