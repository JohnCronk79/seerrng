import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Cache, estimateCacheEntryBytes } from './cache';

describe('Cache', () => {
  it('evicts the least recently set key when its key cap is exceeded', () => {
    const cache = new Cache('tmdb', 'Test cache', {
      checkPeriod: 0,
      maxKeys: 2,
    });

    cache.data.set('first', 1);
    cache.data.set('second', 2);
    cache.data.set('first', 3);
    cache.data.set('third', 4);

    assert.deepStrictEqual(cache.data.keys().sort(), ['first', 'third']);
    assert.strictEqual(cache.data.get('first'), 3);
    assert.strictEqual(cache.data.get('second'), undefined);
  });

  it('forgets key order when the cache is flushed', () => {
    const cache = new Cache('tmdb', 'Test cache', {
      checkPeriod: 0,
      maxKeys: 1,
    });

    cache.data.set('first', 1);
    cache.flush();
    cache.data.set('second', 2);

    assert.deepStrictEqual(cache.data.keys(), ['second']);
  });

  it('evicts entries before exceeding the byte cap', () => {
    const firstValue = 'x'.repeat(64);
    const secondValue = 'y'.repeat(64);
    const maxBytes = Math.max(
      estimateCacheEntryBytes('first', firstValue),
      estimateCacheEntryBytes('second', secondValue)
    );
    const cache = new Cache('tmdb', 'Test cache', {
      checkPeriod: 0,
      maxBytes,
    });

    cache.data.set('first', firstValue);
    cache.data.set('second', secondValue);

    assert.deepStrictEqual(cache.data.keys(), ['second']);
  });

  it('reclaims replaced and deleted entry bytes', () => {
    const small = 'x';
    const maxBytes =
      estimateCacheEntryBytes('first', small) +
      estimateCacheEntryBytes('second', small);
    const cache = new Cache('tmdb', 'Test cache', {
      checkPeriod: 0,
      maxBytes,
    });

    cache.data.set('first', 'x'.repeat(64));
    assert.strictEqual(cache.data.get('first'), undefined);
    cache.data.set('first', small);
    cache.data.set('second', small);
    assert.deepStrictEqual(cache.data.keys().sort(), ['first', 'second']);

    cache.data.del('first');
    cache.data.set('third', small);
    assert.deepStrictEqual(cache.data.keys().sort(), ['second', 'third']);
  });

  it('does not retain a single entry larger than the byte cap', () => {
    const cache = new Cache('tmdb', 'Test cache', {
      checkPeriod: 0,
      maxBytes: 32,
    });

    cache.data.set('oversized', 'x'.repeat(1_000));

    assert.deepStrictEqual(cache.data.keys(), []);
  });
});
