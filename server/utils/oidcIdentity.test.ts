import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseOidcIdentity } from './oidcIdentity';

describe('parseOidcIdentity', () => {
  it('normalizes bounded OIDC identity claims', () => {
    assert.deepStrictEqual(
      parseOidcIdentity({
        sub: ' subject ',
        email: ' User@Example.COM ',
        preferred_username: ' display-name ',
        picture: ' https://example.com/avatar.png ',
      }),
      {
        value: {
          sub: 'subject',
          email: 'user@example.com',
          username: 'display-name',
          picture: 'https://example.com/avatar.png',
        },
      }
    );
  });

  it('rejects invalid subjects and drops malformed optional claims', () => {
    assert.ok('error' in parseOidcIdentity({ sub: 'x'.repeat(256) }));
    assert.deepStrictEqual(
      parseOidcIdentity({
        sub: 'subject',
        email: 'not-an-email',
        preferred_username: 'x'.repeat(101),
        picture: 'javascript:alert(1)',
      }),
      {
        value: {
          sub: 'subject',
          email: undefined,
          username: undefined,
          picture: undefined,
        },
      }
    );
  });
});
