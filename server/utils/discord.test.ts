import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDiscordSnowflake } from './discord';

describe('normalizeDiscordSnowflake', () => {
  it('accepts bounded numeric IDs and rejects mention injection', () => {
    assert.strictEqual(
      normalizeDiscordSnowflake(' 123456789012345678 '),
      '123456789012345678'
    );
    assert.strictEqual(
      normalizeDiscordSnowflake('123> @everyone <@456'),
      undefined
    );
    assert.strictEqual(
      normalizeDiscordSnowflake('18446744073709551616'),
      undefined
    );
  });
});
