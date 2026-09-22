import type { CollectionSyncStatus } from '@server/interfaces/api/collectionSync';

const verificationState = (status?: CollectionSyncStatus, error?: unknown) => {
  if (error || (status && !status.supported)) return 'unavailable';
  if (!status) return 'checking';
  if (status.destinations.some((entry) => entry.state === 'unknown'))
    return 'unavailable';
  if (status.destinations.some((entry) => entry.state === 'conflict'))
    return 'conflict';
};
export const collectionAddState = (
  status?: CollectionSyncStatus,
  error?: unknown
) => {
  const verification = verificationState(status, error);
  if (verification) return verification;
  if (
    status?.destinations.some(
      (entry) => entry.state === 'missing' && entry.count > 0
    )
  )
    return 'ready';
  if (status?.destinations.some((entry) => entry.state === 'exists'))
    return 'exists';
  return 'empty';
};
export const collectionRemoveState = (
  status?: CollectionSyncStatus,
  error?: unknown
) => {
  const verification = verificationState(status, error);
  if (verification) return verification;
  return status?.destinations.some(
    (entry) => entry.state === 'exists' && !!entry.removalToken
  )
    ? 'ready'
    : 'absent';
};
