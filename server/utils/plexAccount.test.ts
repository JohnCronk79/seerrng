import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parsePlexAccountIdentity } from './plexAccount';

describe('parsePlexAccountIdentity', () => {
  it('normalizes a bounded provider identity', () => {
    assert.deepStrictEqual(
      parsePlexAccountIdentity(
        {
          id: 42,
          email: ' User@Example.COM ',
          username: ' plex-user ',
          thumb: ' https://example.com/avatar.png ',
        },
        'request-token'
      ),
      {
        value: {
          id: 42,
          email: 'user@example.com',
          username: 'plex-user',
          thumb: 'https://example.com/avatar.png',
          authToken: 'request-token',
        },
      }
    );
  });

  it('rejects invalid IDs and oversized provider fields', () => {
    for (const account of [
      { id: -1, email: 'user@example.com' },
      { id: 2_147_483_648, email: 'user@example.com' },
      { id: 1, email: 'not-an-email' },
      { id: 1, email: `${'x'.repeat(250)}@example.com` },
      { id: 1, email: 'user@example.com', username: 'x'.repeat(101) },
    ]) {
      assert.ok('error' in parsePlexAccountIdentity(account, 'token'));
    }
  });
});
