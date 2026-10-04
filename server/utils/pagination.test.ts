import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_PAGINATION_OFFSET,
  parseNonNegativeInt,
  parseOptionalPositiveInt,
  parsePageParams,
  parsePositiveInt,
} from './pagination';

describe('parsePositiveInt', () => {
  it('accepts scalar numeric values and clamps to max', () => {
    assert.equal(parsePositiveInt('2', 1, 10), 2);
    assert.equal(parsePositiveInt(3, 1, 10), 3);
    assert.equal(parsePositiveInt('20', 1, 10), 10);
  });

  it('falls back for absent, invalid, non-integer, non-positive, or array values', () => {
    assert.equal(parsePositiveInt(undefined, 1, 10), 1);
    assert.equal(parsePositiveInt('', 1, 10), 1);
    assert.equal(parsePositiveInt('0', 1, 10), 1);
    assert.equal(parsePositiveInt('-1', 1, 10), 1);
    assert.equal(parsePositiveInt('2.9', 1, 10), 1);
    assert.equal(parsePositiveInt('abc', 1, 10), 1);
    assert.equal(parsePositiveInt(['2'], 1, 10), 1);
  });
});

describe('parseNonNegativeInt', () => {
  it('accepts zero and positive scalar values', () => {
    assert.equal(parseNonNegativeInt('0', 5, 10), 0);
    assert.equal(parseNonNegativeInt('4', 5, 10), 4);
    assert.equal(parseNonNegativeInt('20', 5, 10), 10);
  });

  it('falls back for invalid, negative, or array values', () => {
    assert.equal(parseNonNegativeInt(undefined, 5, 10), 5);
    assert.equal(parseNonNegativeInt('-1', 5, 10), 5);
    assert.equal(parseNonNegativeInt('4.5', 5, 10), 5);
    assert.equal(parseNonNegativeInt(['4'], 5, 10), 5);
  });
});

describe('parseOptionalPositiveInt', () => {
  it('accepts positive scalar values and rejects arrays', () => {
    assert.equal(parseOptionalPositiveInt('3', 10), 3);
    assert.equal(parseOptionalPositiveInt(undefined, 10), undefined);
    assert.equal(parseOptionalPositiveInt('', 10), undefined);
    assert.equal(parseOptionalPositiveInt('3.5', 10), undefined);
    assert.equal(parseOptionalPositiveInt(['3'], 10), undefined);
  });
});

describe('parsePageParams', () => {
  it('uses scalar pagination params only', () => {
    assert.deepEqual(
      parsePageParams(
        { take: ['50'], skip: ['100'] },
        { take: 20, maxTake: 100, maxSkip: 1000 }
      ),
      { pageSize: 20, skip: 0 }
    );
    assert.deepEqual(
      parsePageParams(
        { take: '50', skip: '100' },
        { take: 20, maxTake: 100, maxSkip: 1000 }
      ),
      { pageSize: 50, skip: 100 }
    );
  });

  it('caps SQL offsets when a route does not provide a narrower bound', () => {
    assert.deepEqual(
      parsePageParams(
        { take: '20', skip: String(Number.MAX_SAFE_INTEGER) },
        { take: 20 }
      ),
      { pageSize: 20, skip: MAX_PAGINATION_OFFSET }
    );
  });
});
