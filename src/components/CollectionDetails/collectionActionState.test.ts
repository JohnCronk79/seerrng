import type { CollectionSyncStatus } from '@server/interfaces/api/collectionSync';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectionAddState,
  collectionRemoveState,
} from './collectionActionState';
const status = (
  state: 'exists' | 'missing' | 'unknown' | 'conflict',
  count = 1
): CollectionSyncStatus => ({
  supported: true,
  checkedAt: 1,
  destinations: [
    {
      libraryId: '1',
      libraryName: 'Movies',
      state,
      count,
      managed: true,
      removalToken: state === 'exists' ? 'token' : undefined,
    },
  ],
});
describe('collection buttons', () => {
  it('keeps full justification scoped to the collection page in shared CSS', () => {
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(
      css.match(/\.media-detail-disclosure-row\s*\{([^}]+)\}/)?.[1]
    ).not.toContain('justify-between');
    expect(
      css.match(/\.collection-detail-disclosure-row\s*\{([^}]+)\}/)?.[1]
    ).toContain('justify-between');
  });
  it('enables add only for confirmed missing collections with available members', () => {
    expect(collectionAddState(status('missing'))).toBe('ready');
    expect(collectionAddState(status('missing', 0))).toBe('empty');
    expect(collectionAddState(status('exists'))).toBe('exists');
  });
  it('enables removal only for verified existing collections', () => {
    expect(collectionRemoveState(status('exists'))).toBe('ready');
    expect(collectionRemoveState(status('missing'))).toBe('absent');
    const unverified = status('exists');
    delete unverified.destinations[0].removalToken;
    expect(collectionRemoveState(unverified)).toBe('absent');
  });
  it('disables both actions during uncertainty, ambiguity and unsupported configurations', () => {
    for (const action of [collectionAddState, collectionRemoveState]) {
      expect(action()).toBe('checking');
      expect(action(status('unknown'))).toBe('unavailable');
      expect(action(status('conflict'))).toBe('conflict');
      expect(action(status('exists'), new Error('offline'))).toBe(
        'unavailable'
      );
      expect(action({ ...status('missing'), supported: false })).toBe(
        'unavailable'
      );
    }
  });
});
