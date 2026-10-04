import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNonNegativeRouteId, parsePositiveRouteId } from './routeId';

describe('parseNonNegativeRouteId', () => {
  it('accepts zero and positive decimal integer route ids', () => {
    assert.equal(parseNonNegativeRouteId('0'), 0);
    assert.equal(parseNonNegativeRouteId('1'), 1);
    assert.equal(parseNonNegativeRouteId(2), 2);
  });

  it('rejects non-decimal, non-integer, empty, array, and out-of-range ids', () => {
    assert.equal(parseNonNegativeRouteId(''), undefined);
    assert.equal(parseNonNegativeRouteId(' 1 '), undefined);
    assert.equal(parseNonNegativeRouteId('1.5'), undefined);
    assert.equal(parseNonNegativeRouteId('1e2'), undefined);
    assert.equal(parseNonNegativeRouteId('0x10'), undefined);
    assert.equal(parseNonNegativeRouteId(['1']), undefined);
    assert.equal(parseNonNegativeRouteId('11', 10), undefined);
  });
});

describe('parsePositiveRouteId', () => {
  it('accepts positive decimal integer route ids', () => {
    assert.equal(parsePositiveRouteId('1'), 1);
    assert.equal(parsePositiveRouteId(2), 2);
  });

  it('rejects non-decimal, non-integer, empty, array, and out-of-range ids', () => {
    assert.equal(parsePositiveRouteId(''), undefined);
    assert.equal(parsePositiveRouteId(' 1 '), undefined);
    assert.equal(parsePositiveRouteId('1.5'), undefined);
    assert.equal(parsePositiveRouteId('1e2'), undefined);
    assert.equal(parsePositiveRouteId('0x10'), undefined);
    assert.equal(parsePositiveRouteId(['1']), undefined);
    assert.equal(parsePositiveRouteId('0'), undefined);
    assert.equal(parsePositiveRouteId('11', 10), undefined);
  });
});
