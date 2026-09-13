import { Session } from '@server/entity/Session';
import type { SessionData } from 'express-session';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { TypeormSessionStore } from './typeormSessionStore';

const setSession = (
  store: TypeormSessionStore,
  sid: string,
  session: SessionData
) =>
  new Promise<void>((resolve, reject) => {
    store.set(sid, session, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const getSession = (store: TypeormSessionStore, sid: string) =>
  new Promise<SessionData | null>((resolve, reject) => {
    store.get(sid, (error, session) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(session ?? null);
    });
  });

const destroySession = (store: TypeormSessionStore, sid: string | string[]) =>
  new Promise<void>((resolve, reject) => {
    store.destroy(sid, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

test('TypeormSessionStore persists, renews, expires, and destroys sessions', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'seerr-typeorm-session-store-')
  );
  const source = new DataSource({
    type: 'better-sqlite3',
    database: path.join(directory, 'sessions.sqlite3'),
    entities: [Session],
    synchronize: true,
  });

  try {
    await source.initialize();
    const store = new TypeormSessionStore(source.getRepository(Session), {
      cleanupLimit: 2,
      ttl: 60,
    });
    const session = {
      cookie: { maxAge: 60_000 },
      userId: 42,
    } as SessionData;

    await setSession(store, 'session-a', session);
    assert.deepStrictEqual(await getSession(store, 'session-a'), session);

    await setSession(store, 'session-a', {
      ...session,
      userId: 43,
    });
    assert.equal(
      await source.getRepository(Session).count({ where: { id: 'session-a' } }),
      1
    );
    assert.equal((await getSession(store, 'session-a'))?.userId, 43);

    await source.getRepository(Session).insert({
      id: 'expired-session',
      expiredAt: Date.now() - 1,
      json: '{}',
    });
    await setSession(store, 'session-b', session);
    assert.equal(
      await source.getRepository(Session).count({
        where: { id: 'expired-session' },
        withDeleted: true,
      }),
      0
    );

    await destroySession(store, ['session-a', 'session-b']);
    assert.equal(await getSession(store, 'session-a'), null);
    assert.equal(await getSession(store, 'session-b'), null);
  } finally {
    if (source.isInitialized) await source.destroy();
    await fs.rm(directory, { force: true, recursive: true });
  }
});
