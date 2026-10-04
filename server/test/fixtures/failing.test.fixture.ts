import assert from 'node:assert/strict';
import { test } from 'node:test';

test('intentional runner failure', () => {
  assert.fail('intentional failure');
});
