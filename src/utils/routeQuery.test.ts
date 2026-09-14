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
