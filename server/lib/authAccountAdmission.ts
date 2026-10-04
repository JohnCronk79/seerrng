import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import AsyncLock from '@server/utils/asyncLock';
import { createDeterministicKey } from '@server/utils/deterministicKey';

const authAccountAdmissionLock = new AsyncLock();

export type AuthAccountIdentityType = 'email' | 'jellyfin' | 'oidc' | 'plex';

export const getAuthAccountAdmissionResource = (
  type: AuthAccountIdentityType,
  identity: string
): string => {
  if (!identity) {
    throw new Error('A non-empty auth account identity is required.');
  }
  return `auth-account:${type}:${createDeterministicKey(identity)}`;
};

/**
 * Serializes canonical account identity decisions both within one process and,
 * on PostgreSQL, across application instances. Call this before acquiring any
 * user-security mutation locks so competing identity-link and user-mutation
 * paths cannot invert their lock order.
 */
export const runAuthAccountAdmission = <Result>(
  resourceKeys: string[],
  callback: () => Promise<Result>
): Promise<Result> => {
  const keys = [...new Set(resourceKeys)].sort();
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        !/^auth-account:(?:email|jellyfin|oidc|plex):[a-f0-9]{16}$/.test(key)
    )
  ) {
    throw new Error('At least one valid auth account resource is required.');
  }

  const dispatch = (index: number): Promise<Result> =>
    index === keys.length
      ? requestAdmissionCoordinator.run(keys, callback)
      : authAccountAdmissionLock.dispatch(keys[index], () =>
          dispatch(index + 1)
        );

  return dispatch(0);
};
