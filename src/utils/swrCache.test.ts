import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { getPersistentResponse, setPersistentResponse } from './swrCache';

class MemoryStorage {
  public readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('persistent response cache', () => {
  it('round-trips current records and evicts future-dated records', () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });

    setPersistentResponse('discover', [{ id: 1 }]);
    assert.deepStrictEqual(getPersistentResponse('discover'), [{ id: 1 }]);

    const [cacheKey] = storage.values.keys();
    storage.setItem(
      cacheKey,
      JSON.stringify({ timestamp: Date.now() + 60_000, data: ['stale'] })
    );
    assert.strictEqual(getPersistentResponse('discover'), undefined);
    assert.strictEqual(storage.getItem(cacheKey), null);
  });
});
