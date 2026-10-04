import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PERMISSION_VALUE,
  Permission,
  hasAutoApprovePermission,
  hasPermission,
  isValidPermissionValue,
} from './permissions';

describe('permission masks', () => {
  it('supports permission bits beyond JavaScript bitwise integer range', () => {
    const permissions = Permission.REQUEST_MUSIC + Permission.REQUEST_BOOK;

    assert.equal(hasPermission(Permission.REQUEST_MUSIC, permissions), true);
    assert.equal(hasPermission(Permission.REQUEST_BOOK, permissions), true);
    assert.equal(hasPermission(Permission.ADMIN, permissions), false);
  });

  it('fails closed on corrupt or unsupported persisted values', () => {
    for (const value of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_PERMISSION_VALUE + 1,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.equal(isValidPermissionValue(value), false);
      assert.equal(hasPermission(Permission.ADMIN, value), false);
      assert.equal(hasPermission(Permission.REQUEST_BOOK, value), false);
    }
  });
});

describe('request auto approval', () => {
  it('uses the request owner permissions for each media type and quality', () => {
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_MOVIE, 'movie'),
      true
    );
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_MOVIE, 'tv'),
      false
    );
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_4K_MOVIE, 'movie', true),
      true
    );
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_MOVIE, 'movie', true),
      false
    );
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_MUSIC, 'music'),
      true
    );
    assert.equal(
      hasAutoApprovePermission(Permission.AUTO_APPROVE_BOOK, 'book'),
      true
    );
  });

  it('treats administrators and request managers as auto-approved owners', () => {
    assert.equal(hasAutoApprovePermission(Permission.ADMIN, 'book'), true);
    assert.equal(
      hasAutoApprovePermission(Permission.MANAGE_REQUESTS, 'tv', true),
      true
    );
  });
});
