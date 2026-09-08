import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canLoadRequestStatus } from './requestStatusQuery';

describe('canLoadRequestStatus', () => {
  it('loads an unscoped query for the All Users selection', () => {
    assert.equal(
      canLoadRequestStatus({
        currentUserId: 1,
        canViewOtherUsers: true,
        selectedUser: 'all',
      }),
      true
    );
  });

  it('waits for a manager user selection to initialize', () => {
    assert.equal(
      canLoadRequestStatus({
        currentUserId: 1,
        canViewOtherUsers: true,
        selectedUser: null,
      }),
      false
    );
  });

  it('loads the current user view without a manager selection', () => {
    assert.equal(
      canLoadRequestStatus({
        currentUserId: 2,
        canViewOtherUsers: false,
        selectedUser: null,
      }),
      true
    );
  });
});
