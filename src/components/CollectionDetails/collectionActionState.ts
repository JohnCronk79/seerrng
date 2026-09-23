import type {
  CollectionDestination,
  CollectionSyncStatus,
} from '@server/interfaces/api/collectionSync';

export const selectedDestinationCount = (
  entry: CollectionDestination,
  selectedIds?: string[]
) =>
  selectedIds === undefined
    ? entry.count
    : entry.availableIds === undefined
      ? 0
      : entry.availableIds.filter((id) => selectedIds.includes(id)).length;

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
  error?: unknown,
  selectedIds?: string[]
) => {
  const verification = verificationState(status, error);
  if (verification) return verification;
  if (
    status?.destinations.some(
      (entry) =>
        entry.state === 'missing' &&
        selectedDestinationCount(entry, selectedIds) > 0
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
