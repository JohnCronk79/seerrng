import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getLocaleDifferences } = require('./check-i18n-lib.js');

test('reports stale English message overrides with both values', () => {
  assert.deepEqual(
    getLocaleDifferences(
      JSON.stringify({ 'components.Movie.reportissue': 'Create Issue' }),
      JSON.stringify({ 'components.Movie.reportissue': 'Report an Issue' })
    ),
    [
      {
        key: 'components.Movie.reportissue',
        original: 'Create Issue',
        extracted: 'Report an Issue',
      },
    ]
  );
});

test('reports added and removed message keys', () => {
  assert.deepEqual(
    getLocaleDifferences(
      JSON.stringify({ removed: 'Old' }),
      JSON.stringify({ added: 'New' })
    ),
    [
      { key: 'added', original: undefined, extracted: 'New' },
      { key: 'removed', original: 'Old', extracted: undefined },
    ]
  );
});
