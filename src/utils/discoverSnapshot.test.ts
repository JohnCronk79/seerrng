import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISCOVER_SNAPSHOT_FRESH_AGE,
  DISCOVER_SNAPSHOT_MAX_AGE,
  buildDiscoverCacheContextKey,
  buildDiscoverSnapshotKey,
  createDiscoverSnapshot,
  isDiscoverSnapshotFresh,
  readDiscoverSnapshot,
  writeDiscoverSnapshot,
} from './discoverSnapshot';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MemoryPayloadStore {
  private values = new Map<string, unknown>();

  async delete(key: string) {
    this.values.delete(key);
  }

  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T) {
    this.values.set(key, value);
  }
}

const context = {
  userId: 12,
  permissions: 32,
  discoverRegion: 'US',
  streamingRegion: 'US',
  originalLanguage: 'en',
};

describe('discover snapshots', () => {
  it('isolates cache keys by user and effective discover context', () => {
    const firstContext = buildDiscoverCacheContextKey(context);
    const otherUser = buildDiscoverCacheContextKey({
      ...context,
      userId: 13,
    });
    const otherRegion = buildDiscoverCacheContextKey({
      ...context,
      discoverRegion: 'CA',
    });

    assert.notEqual(firstContext, otherUser);
    assert.notEqual(firstContext, otherRegion);
    assert.notEqual(
      buildDiscoverSnapshotKey(firstContext, 'popular', '/discover', 'a=b'),
      buildDiscoverSnapshotKey(otherUser, 'popular', '/discover', 'a=b')
    );
  });

  it('keeps large payloads out of localStorage and preserves snapshot metadata', async () => {
    const storage = new MemoryStorage();
    const payloadStore = new MemoryPayloadStore();
    const contextKey = buildDiscoverCacheContextKey(context);
    const key = buildDiscoverSnapshotKey(
      contextKey,
      'popular',
      '/api/v1/discover/movies'
    );
    const snapshot = createDiscoverSnapshot(contextKey, [{ id: 1 }], {
      now: 1_000,
      seed: 'stable-seed',
      manifestVersion: 1,
      layoutRevision: 'layout-2',
      userStateRevision: 'state-3',
    });

    await writeDiscoverSnapshot(storage, payloadStore, key, snapshot);

    assert.deepEqual(
      await readDiscoverSnapshot<{ id: number }[]>(
        storage,
        payloadStore,
        key,
        contextKey,
        1_000 + DISCOVER_SNAPSHOT_MAX_AGE - 1
      ),
      snapshot
    );
    assert.equal(storage.getItem(key), null);
    assert.equal(snapshot.metadata.seed, 'stable-seed');
    assert.equal(snapshot.metadata.manifestVersion, 1);
  });

  it('distinguishes fresh snapshots from stale fallbacks', () => {
    const snapshot = createDiscoverSnapshot('context', [], { now: 10_000 });

    assert.equal(
      isDiscoverSnapshotFresh(
        snapshot,
        10_000 + DISCOVER_SNAPSHOT_FRESH_AGE - 1
      ),
      true
    );
    assert.equal(
      isDiscoverSnapshotFresh(snapshot, 10_000 + DISCOVER_SNAPSHOT_FRESH_AGE),
      false
    );
  });

  it('migrates legacy localStorage payloads into the payload store', async () => {
    const storage = new MemoryStorage();
    const payloadStore = new MemoryPayloadStore();
    const contextKey = buildDiscoverCacheContextKey(context);
    const key = buildDiscoverSnapshotKey(
      contextKey,
      'popular',
      '/api/v1/discover/movies'
    );
    const legacyKey = key.replace(
      'seerr-discover-snapshot-v2:',
      'seerr-discover-snapshot-v1:'
    );
    storage.setItem(
      legacyKey,
      JSON.stringify({
        metadata: {
          schemaVersion: 1,
          contextKey,
          createdAt: 1_000,
          freshUntil: 2_000,
          expiresAt: 10_000,
          seed: 'legacy-seed',
        },
        data: [{ id: 1 }],
      })
    );

    const migrated = await readDiscoverSnapshot<{ id: number }[]>(
      storage,
      payloadStore,
      key,
      contextKey,
      1_500
    );

    assert.deepEqual(migrated?.data, [{ id: 1 }]);
    assert.equal(migrated?.metadata.seed, 'legacy-seed');
    assert.equal(storage.getItem(legacyKey), null);
    assert.deepEqual(await payloadStore.get(key), [{ id: 1 }]);
  });

  it('rejects expired and mismatched-context snapshots', async () => {
    const storage = new MemoryStorage();
    const payloadStore = new MemoryPayloadStore();
    const snapshot = createDiscoverSnapshot('user-1', ['cached'], { now: 0 });

    await writeDiscoverSnapshot(storage, payloadStore, 'expired', snapshot);
    assert.equal(
      await readDiscoverSnapshot(
        storage,
        payloadStore,
        'expired',
        'user-1',
        DISCOVER_SNAPSHOT_MAX_AGE
      ),
      undefined
    );
    assert.equal(await payloadStore.get('expired'), undefined);

    await writeDiscoverSnapshot(storage, payloadStore, 'wrong-user', snapshot);
    assert.equal(
      await readDiscoverSnapshot(
        storage,
        payloadStore,
        'wrong-user',
        'user-2',
        1
      ),
      undefined
    );
    assert.equal(await payloadStore.get('wrong-user'), undefined);
  });

  it('contains storage denial during reads and cleanup', async () => {
    const payloadStore = new MemoryPayloadStore();
    await payloadStore.set('denied', ['stale']);
    const deniedStorage = {
      getItem: () => {
        throw new Error('read denied');
      },
      setItem: () => {
        throw new Error('write denied');
      },
      removeItem: () => {
        throw new Error('cleanup denied');
      },
    };

    assert.strictEqual(
      await readDiscoverSnapshot(
        deniedStorage,
        payloadStore,
        'denied',
        'context'
      ),
      undefined
    );
    assert.strictEqual(await payloadStore.get('denied'), undefined);

    await writeDiscoverSnapshot(
      deniedStorage,
      payloadStore,
      'denied-write',
      createDiscoverSnapshot('context', ['payload'])
    );
    assert.strictEqual(await payloadStore.get('denied-write'), undefined);
  });

  it('rejects internally inconsistent snapshot timestamps', async () => {
    const storage = new MemoryStorage();
    const payloadStore = new MemoryPayloadStore();
    await payloadStore.set('corrupt', ['stale']);
    storage.setItem(
      'corrupt:metadata',
      JSON.stringify({
        schemaVersion: 2,
        contextKey: 'context',
        createdAt: 100,
        freshUntil: 50,
        expiresAt: 200,
      })
    );

    assert.strictEqual(
      await readDiscoverSnapshot(
        storage,
        payloadStore,
        'corrupt',
        'context',
        125
      ),
      undefined
    );
    assert.strictEqual(await payloadStore.get('corrupt'), undefined);
  });

  it('serializes payload and metadata writes for the same snapshot key', async () => {
    const storage = new MemoryStorage();
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const firstWriteReady = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let writes = 0;
    const payloadStore = new MemoryPayloadStore();
    const originalSet = payloadStore.set.bind(payloadStore);
    payloadStore.set = async <T>(key: string, value: T) => {
      writes += 1;
      await originalSet(key, value);
      if (writes === 1) {
        firstWriteStarted();
        await firstWriteGate;
      }
    };

    const firstSnapshot = createDiscoverSnapshot('context', ['first'], {
      now: 1_000,
    });
    const secondSnapshot = createDiscoverSnapshot('context', ['second'], {
      now: 2_000,
    });
    const firstWrite = writeDiscoverSnapshot(
      storage,
      payloadStore,
      'shared',
      firstSnapshot
    );
    await firstWriteReady;
    const secondWrite = writeDiscoverSnapshot(
      storage,
      payloadStore,
      'shared',
      secondSnapshot
    );

    await Promise.resolve();
    assert.equal(writes, 1);
    releaseFirstWrite();
    await Promise.all([firstWrite, secondWrite]);
    const persisted = await readDiscoverSnapshot(
      storage,
      payloadStore,
      'shared',
      'context',
      2_000
    );
    assert.deepEqual(persisted?.data, secondSnapshot.data);
    assert.equal(
      persisted?.metadata.createdAt,
      secondSnapshot.metadata.createdAt
    );
  });
});
