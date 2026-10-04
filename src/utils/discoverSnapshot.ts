import { useEffect, useState } from 'react';

export const DISCOVER_SNAPSHOT_SCHEMA_VERSION = 2;
export const DISCOVER_SNAPSHOT_FRESH_AGE = 1000 * 60 * 5;
export const DISCOVER_SNAPSHOT_MAX_AGE = 1000 * 60 * 60 * 24;

const DISCOVER_SNAPSHOT_PREFIX = 'seerr-discover-snapshot-v2:';
const LEGACY_DISCOVER_SNAPSHOT_PREFIX = 'seerr-discover-snapshot-v1:';
const DISCOVER_SNAPSHOT_METADATA_SUFFIX = ':metadata';
const DISCOVER_DATABASE_NAME = 'seerr-discover-cache';
const DISCOVER_DATABASE_STORE = 'snapshots';

export interface DiscoverCacheContext {
  userId: number;
  permissions: number;
  discoverRegion: string;
  streamingRegion: string;
  originalLanguage: string;
}

export interface DiscoverSnapshotMetadata {
  schemaVersion: typeof DISCOVER_SNAPSHOT_SCHEMA_VERSION;
  contextKey: string;
  createdAt: number;
  freshUntil: number;
  expiresAt: number;
  seed?: string;
  manifestVersion?: number;
  layoutRevision?: string;
  userStateRevision?: string;
}

export interface DiscoverSnapshot<T> {
  metadata: DiscoverSnapshotMetadata;
  data: T;
}

export interface DiscoverPayloadStore {
  delete(key: string): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const removeStoredSnapshotValue = (storage: StorageLike, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Browser storage is optional and can become unavailable between calls.
  }
};

const getBrowserStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

let databasePromise: Promise<IDBDatabase> | undefined;
const snapshotOperationTails = new Map<string, Promise<void>>();

const runSnapshotOperation = <T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = snapshotOperationTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  snapshotOperationTails.set(key, tail);
  void tail.finally(() => {
    if (snapshotOperationTails.get(key) === tail) {
      snapshotOperationTails.delete(key);
    }
  });
  return current;
};

const getDatabase = (): Promise<IDBDatabase> => {
  if (!databasePromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DISCOVER_DATABASE_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onupgradeneeded = () => {
        if (
          !request.result.objectStoreNames.contains(DISCOVER_DATABASE_STORE)
        ) {
          request.result.createObjectStore(DISCOVER_DATABASE_STORE);
        }
      };
    });
    databasePromise = opening.catch((error) => {
      // A transient denial or failed open must not poison every later cache
      // operation until the page is reloaded.
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
};

const runDatabaseRequest = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const database = await getDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DISCOVER_DATABASE_STORE, mode);
    let request: IDBRequest<T>;
    try {
      request = operation(transaction.objectStore(DISCOVER_DATABASE_STORE));
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    let result: T;
    let requestCompleted = false;
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      result = request.result;
      requestCompleted = true;
    };
    transaction.oncomplete = () => {
      if (requestCompleted) {
        resolve(result);
      } else {
        reject(new Error('IndexedDB transaction completed without a result.'));
      }
    };
    transaction.onerror = () =>
      reject(
        transaction.error ?? request.error ?? new Error('IndexedDB error')
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? request.error ?? new Error('IndexedDB aborted')
      );
  });
};

const browserPayloadStore: DiscoverPayloadStore = {
  delete: async (key) => {
    await runDatabaseRequest('readwrite', (store) => store.delete(key));
  },
  get: async <T>(key: string) =>
    runDatabaseRequest<T | undefined>('readonly', (store) => store.get(key)),
  set: async <T>(key: string, value: T) => {
    await runDatabaseRequest('readwrite', (store) => store.put(value, key));
  },
};

const getBrowserPayloadStore = (): DiscoverPayloadStore | undefined =>
  typeof indexedDB === 'undefined' ? undefined : browserPayloadStore;

export const buildDiscoverCacheContextKey = (
  context: DiscoverCacheContext
): string =>
  [
    context.userId,
    context.permissions,
    context.discoverRegion,
    context.streamingRegion,
    context.originalLanguage,
  ]
    .map((value) => encodeURIComponent(String(value)))
    .join(':');

export const buildDiscoverSnapshotKey = (
  contextKey: string,
  rowKey: string,
  url: string,
  extraParams = ''
): string =>
  `${DISCOVER_SNAPSHOT_PREFIX}${encodeURIComponent(
    contextKey
  )}:${encodeURIComponent(rowKey)}:${encodeURIComponent(
    url
  )}:${encodeURIComponent(extraParams)}`;

export const createDiscoverSnapshot = <T>(
  contextKey: string,
  data: T,
  {
    now = Date.now(),
    freshAgeMs = DISCOVER_SNAPSHOT_FRESH_AGE,
    seed,
    manifestVersion,
    layoutRevision,
    userStateRevision,
  }: Partial<
    Pick<
      DiscoverSnapshotMetadata,
      'seed' | 'manifestVersion' | 'layoutRevision' | 'userStateRevision'
    >
  > & { now?: number; freshAgeMs?: number } = {}
): DiscoverSnapshot<T> => ({
  metadata: {
    schemaVersion: DISCOVER_SNAPSHOT_SCHEMA_VERSION,
    contextKey,
    createdAt: now,
    freshUntil: now + freshAgeMs,
    expiresAt: now + DISCOVER_SNAPSHOT_MAX_AGE,
    seed,
    manifestVersion,
    layoutRevision,
    userStateRevision,
  },
  data,
});

const isSnapshotMetadata = (
  value: unknown
): value is DiscoverSnapshotMetadata => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metadata = value as Partial<DiscoverSnapshotMetadata>;

  return (
    metadata.schemaVersion === DISCOVER_SNAPSHOT_SCHEMA_VERSION &&
    typeof metadata.contextKey === 'string' &&
    typeof metadata.createdAt === 'number' &&
    Number.isFinite(metadata.createdAt) &&
    typeof metadata.freshUntil === 'number' &&
    Number.isFinite(metadata.freshUntil) &&
    typeof metadata.expiresAt === 'number' &&
    Number.isFinite(metadata.expiresAt) &&
    metadata.createdAt <= metadata.freshUntil &&
    metadata.freshUntil <= metadata.expiresAt
  );
};

const getMetadataKey = (key: string) =>
  `${key}${DISCOVER_SNAPSHOT_METADATA_SUFFIX}`;

export const readDiscoverSnapshot = async <T>(
  storage: StorageLike,
  payloadStore: DiscoverPayloadStore,
  key: string,
  contextKey: string,
  now = Date.now()
): Promise<DiscoverSnapshot<T> | undefined> =>
  runSnapshotOperation(key, async () => {
    const metadataKey = getMetadataKey(key);

    try {
      const rawMetadata = storage.getItem(metadataKey);
      const metadata: unknown = rawMetadata
        ? JSON.parse(rawMetadata)
        : undefined;

      if (!rawMetadata) {
        const legacyKey = key.replace(
          DISCOVER_SNAPSHOT_PREFIX,
          LEGACY_DISCOVER_SNAPSHOT_PREFIX
        );
        const rawLegacySnapshot = storage.getItem(legacyKey);
        const legacySnapshot = rawLegacySnapshot
          ? (JSON.parse(rawLegacySnapshot) as {
              metadata?: Omit<DiscoverSnapshotMetadata, 'schemaVersion'> & {
                schemaVersion?: number;
              };
              data?: T;
            })
          : undefined;
        const legacyMetadata = legacySnapshot?.metadata;

        if (
          legacyMetadata?.schemaVersion === 1 &&
          legacyMetadata.contextKey === contextKey &&
          typeof legacyMetadata.createdAt === 'number' &&
          Number.isFinite(legacyMetadata.createdAt) &&
          typeof legacyMetadata.freshUntil === 'number' &&
          Number.isFinite(legacyMetadata.freshUntil) &&
          typeof legacyMetadata.expiresAt === 'number' &&
          Number.isFinite(legacyMetadata.expiresAt) &&
          legacyMetadata.createdAt <= legacyMetadata.freshUntil &&
          legacyMetadata.freshUntil <= legacyMetadata.expiresAt &&
          legacyMetadata.expiresAt > now &&
          legacySnapshot?.data !== undefined
        ) {
          const migratedSnapshot = createDiscoverSnapshot(
            contextKey,
            legacySnapshot.data,
            {
              now: legacyMetadata.createdAt,
              freshAgeMs: Math.max(
                0,
                legacyMetadata.freshUntil - legacyMetadata.createdAt
              ),
              seed: legacyMetadata.seed,
              layoutRevision: legacyMetadata.layoutRevision,
              userStateRevision: legacyMetadata.userStateRevision,
            }
          );
          migratedSnapshot.metadata.expiresAt = legacyMetadata.expiresAt;

          await writeDiscoverSnapshotUnlocked(
            storage,
            payloadStore,
            key,
            migratedSnapshot
          );
          removeStoredSnapshotValue(storage, legacyKey);
          return migratedSnapshot;
        }
      }

      if (
        !isSnapshotMetadata(metadata) ||
        metadata.contextKey !== contextKey ||
        metadata.expiresAt <= now
      ) {
        removeStoredSnapshotValue(storage, metadataKey);
        await payloadStore.delete(key);
        return undefined;
      }

      const data = await payloadStore.get<T>(key);

      if (data === undefined) {
        removeStoredSnapshotValue(storage, metadataKey);
        return undefined;
      }

      return { metadata, data };
    } catch {
      removeStoredSnapshotValue(storage, metadataKey);
      await payloadStore.delete(key).catch(() => undefined);
      return undefined;
    }
  });

const writeDiscoverSnapshotUnlocked = async <T>(
  storage: StorageLike,
  payloadStore: DiscoverPayloadStore,
  key: string,
  snapshot: DiscoverSnapshot<T>
) => {
  try {
    await payloadStore.set(key, snapshot.data);
    storage.setItem(getMetadataKey(key), JSON.stringify(snapshot.metadata));
  } catch {
    removeStoredSnapshotValue(storage, getMetadataKey(key));
    await payloadStore.delete(key).catch(() => undefined);
  }
};

export const writeDiscoverSnapshot = <T>(
  storage: StorageLike,
  payloadStore: DiscoverPayloadStore,
  key: string,
  snapshot: DiscoverSnapshot<T>
): Promise<void> =>
  runSnapshotOperation(key, () =>
    writeDiscoverSnapshotUnlocked(storage, payloadStore, key, snapshot)
  );

export const isDiscoverSnapshotFresh = (
  snapshot: DiscoverSnapshot<unknown>,
  now = Date.now()
): boolean => snapshot.metadata.freshUntil > now;

export const setDiscoverSnapshot = async <T>(
  key: string,
  snapshot: DiscoverSnapshot<T>
) => {
  const storage = getBrowserStorage();
  const payloadStore = getBrowserPayloadStore();

  if (storage && payloadStore) {
    await writeDiscoverSnapshot(storage, payloadStore, key, snapshot);
  }
};

export const useDiscoverSnapshot = <T>(
  key: string | undefined,
  contextKey: string | undefined
): { hydrated: boolean; snapshot?: DiscoverSnapshot<T> } => {
  const [response, setResponse] = useState<{
    key?: string;
    snapshot?: DiscoverSnapshot<T>;
  }>();

  useEffect(() => {
    const storage = getBrowserStorage();
    const payloadStore = getBrowserPayloadStore();
    let cancelled = false;

    const hydrate = async () => {
      const snapshot =
        storage && payloadStore && key && contextKey
          ? await readDiscoverSnapshot<T>(
              storage,
              payloadStore,
              key,
              contextKey
            )
          : undefined;

      if (!cancelled) {
        setResponse({ key, snapshot });
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [contextKey, key]);

  const hydrated = response?.key === key;

  return {
    hydrated,
    snapshot: hydrated ? response?.snapshot : undefined,
  };
};
