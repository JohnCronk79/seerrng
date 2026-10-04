import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getRemoteAvatarCacheUrl,
  isRemoteAvatarCacheUrlAllowed,
} from './remoteAvatarCache';

describe('isRemoteAvatarCacheUrlAllowed', () => {
  it('allows known HTTPS avatar providers', () => {
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(new URL('https://gravatar.com/avatar/abc')),
      true
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(
        new URL('https://images.plex.tv/users/1/avatar')
      ),
      true
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(new URL('https://plex.tv/users/1/avatar')),
      true
    );
  });

  it('rejects non-HTTPS, credentials, and unrelated hosts', () => {
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(new URL('http://gravatar.com/avatar/abc')),
      false
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(
        new URL('https://user:pass@gravatar.com/avatar/abc')
      ),
      false
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed(new URL('https://example.com/avatar.png')),
      false
    );
  });
});

describe('getRemoteAvatarCacheUrl', () => {
  it('normalizes accepted avatar URLs', () => {
    assert.equal(
      getRemoteAvatarCacheUrl('https://secure.gravatar.com/avatar/abc?d=mm'),
      'https://secure.gravatar.com/avatar/abc?d=mm'
    );
  });

  it('returns undefined for rejected or invalid input', () => {
    assert.equal(getRemoteAvatarCacheUrl('not-a-url'), undefined);
    assert.equal(
      getRemoteAvatarCacheUrl('https://example.com/a.png'),
      undefined
    );
    assert.equal(getRemoteAvatarCacheUrl(undefined), undefined);
  });
});
