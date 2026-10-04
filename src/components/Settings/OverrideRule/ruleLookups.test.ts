import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getOverrideRuleKeywordIds,
  getOverrideRuleUserIds,
  MAX_RULE_LOOKUP_IDS,
} from './ruleLookups';

describe('override rule lookup bounds', () => {
  it('deduplicates, validates, and caps browser lookup fanout', () => {
    const ids = Array.from({ length: MAX_RULE_LOOKUP_IDS + 10 }, (_, index) =>
      String(index + 1)
    );
    const rules = [
      { users: `2,1,2,invalid,0,1000000001`, keywords: ids.join(',') },
      { users: '3', keywords: '1,2' },
    ];

    assert.deepStrictEqual(getOverrideRuleUserIds(rules), ['2', '1', '3']);
    assert.strictEqual(
      getOverrideRuleKeywordIds(rules).length,
      MAX_RULE_LOOKUP_IDS
    );
    assert.deepStrictEqual(getOverrideRuleKeywordIds(rules).slice(0, 3), [
      '1',
      '2',
      '3',
    ]);
  });
});
