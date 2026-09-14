import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQueryFromPath } from './routeQuery';

test('parses repeated and encoded query values from a route path', () => {
  assert.deepEqual(
    parseQueryFromPath(
      '/discover/books?subject=fantasy&sortBy=rating&tag=one&tag=two#results'
    ),
    {
      subject: 'fantasy',
      sortBy: 'rating',
      tag: ['one', 'two'],
    }
  );
});

test('returns no query values for a path without a query string', () => {
  assert.deepEqual(parseQueryFromPath('/discover/books'), {});
});

test('keeps prototype-like query keys as data', () => {
  const query = parseQueryFromPath(
    '/discover/books?__proto__=polluted&constructor=custom'
  );

  assert.equal(Object.getPrototypeOf(query), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(query, '__proto__'), true);
  assert.equal(
    Object.getOwnPropertyDescriptor(query, '__proto__')?.value,
    'polluted'
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(query, 'constructor')?.value,
    'custom'
  );
  assert.equal(({} as { polluted?: string }).polluted, undefined);
});
