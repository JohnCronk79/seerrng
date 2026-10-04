import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeSqlLikePattern } from './sqlLike';

describe('escapeSqlLikePattern', () => {
  it('escapes SQL LIKE wildcard and escape characters', () => {
    assert.equal(escapeSqlLikePattern('100%_\\done'), '100\\%\\_\\\\done');
  });
});
