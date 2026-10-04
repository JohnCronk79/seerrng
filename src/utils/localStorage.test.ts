import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getBrowserStorage,
  isStoredOption,
  isStoredPageSize,
  readStoredRecord,
  readStoredValue,
  writeStoredRecord,
  writeStoredValue,
} from './localStorage';

describe('stored UI state', () => {
  it('reads only JSON records and recovers from malformed or unavailable storage', () => {
    assert.deepStrictEqual(
      readStoredRecord({ getItem: () => '{"page":25}' }, 'settings'),
      { page: 25 }
    );
    for (const value of ['{', '[]', 'null', '"text"']) {
      assert.strictEqual(
        readStoredRecord({ getItem: () => value }, 'settings'),
        undefined
      );
    }
    assert.strictEqual(
      readStoredRecord(
        {
          getItem: () => {
            throw new Error('storage denied');
          },
        },
        'settings'
      ),
      undefined
    );
  });

  it('contains storage write failures', () => {
    let serialized = '';
    assert.strictEqual(
      writeStoredRecord(
        { setItem: (_key, value) => (serialized = value) },
        'settings',
        { page: 25 }
      ),
      true
    );
    assert.strictEqual(serialized, '{"page":25}');
    assert.strictEqual(
      writeStoredRecord(
        {
          setItem: () => {
            throw new Error('quota exceeded');
          },
        },
        'settings',
        { page: 25 }
      ),
      false
    );
  });

  it('contains storage access and scalar operation failures', () => {
    assert.strictEqual(
      getBrowserStorage(() => {
        throw new Error('storage getter denied');
      }),
      undefined
    );
    assert.strictEqual(
      readStoredValue(
        {
          getItem: () => {
            throw new Error('read denied');
          },
        },
        'setting'
      ),
      undefined
    );
    assert.strictEqual(writeStoredValue(undefined, 'setting', 'value'), false);
    assert.strictEqual(
      writeStoredValue(
        {
          setItem: () => {
            throw new Error('write denied');
          },
        },
        'setting',
        'value'
      ),
      false
    );
  });

  it('admits only declared options and bounded page sizes', () => {
    assert.strictEqual(isStoredOption('added', ['added', 'modified']), true);
    assert.strictEqual(isStoredOption('unknown', ['added', 'modified']), false);
    assert.strictEqual(isStoredPageSize(100), true);
    assert.strictEqual(isStoredPageSize(10_000), false);
    assert.strictEqual(isStoredPageSize('100'), false);
    assert.strictEqual(isStoredPageSize(5, [10, 25, 50, 100]), false);
  });
});
