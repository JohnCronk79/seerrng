import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';

import * as datasource from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import {
  getPendingBackgroundTaskCount,
  waitForBackgroundTasks,
} from '@server/utils/backgroundTasks';
import type { NextFunction, Response } from 'express';
import { authorizedMutation, authorizedRouteScope } from './authorizedMutation';

describe('authorizedMutation', () => {
  it('rejects requests without an authenticated actor', async () => {
    let error: { status?: number } | undefined;
    let called = false;
    const middleware = authorizedMutation(Permission.ADMIN, async () => {
      called = true;
    });

    await middleware(
      {} as Parameters<typeof middleware>[0],
      {} as Response,
      ((value: { status?: number }) => {
        error = value;
      }) as NextFunction
    );

    assert.strictEqual(called, false);
    assert.strictEqual(error?.status, 403);
  });

  it('holds route authorization until the response finishes', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () => new User({ id: 4, permissions: Permission.ADMIN }),
    }));
    const middleware = authorizedRouteScope(Permission.ADMIN);
    const response = new EventEmitter() as Response & EventEmitter;
    let admitted = false;

    await middleware(
      {
        user: new User({ id: 4, permissions: Permission.ADMIN }),
      } as Parameters<typeof middleware>[0],
      response,
      (() => undefined) as NextFunction
    );
    const competingMutation = runUserSecurityMutation(4, async () => {
      admitted = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(admitted, false);

    response.emit('finish');
    assert.strictEqual(getPendingBackgroundTaskCount(), 1);
    await competingMutation;
    await waitForBackgroundTasks();
    assert.strictEqual(admitted, true);
    assert.strictEqual(getPendingBackgroundTaskCount(), 0);
    mock.restoreAll();
  });

  it('holds explicitly protected users until the response finishes', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () => new User({ id: 4, permissions: Permission.ADMIN }),
    }));
    const middleware = authorizedRouteScope(Permission.ADMIN, [1]);
    const response = new EventEmitter() as Response & EventEmitter;
    let admitted = false;

    await middleware(
      {
        user: new User({ id: 4, permissions: Permission.ADMIN }),
      } as Parameters<typeof middleware>[0],
      response,
      (() => undefined) as NextFunction
    );
    const competingMutation = runUserSecurityMutation(1, async () => {
      admitted = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(admitted, false);

    response.emit('finish');
    assert.strictEqual(getPendingBackgroundTaskCount(), 1);
    await competingMutation;
    await waitForBackgroundTasks();
    assert.strictEqual(admitted, true);
    assert.strictEqual(getPendingBackgroundTaskCount(), 0);
    mock.restoreAll();
  });

  it('rejects a scoped route after the session credential changes', async () => {
    const changedAt = new Date('2026-07-16T12:00:00.000Z');
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({
          id: 4,
          permissions: Permission.ADMIN,
          passwordChangedAt: changedAt,
        }),
    }));
    const middleware = authorizedRouteScope(Permission.ADMIN);
    const response = new EventEmitter() as Response & EventEmitter;
    let error: { status?: number } | undefined;
    let admitted = false;

    await middleware(
      {
        user: new User({ id: 4, permissions: Permission.ADMIN }),
        session: {
          userId: 4,
          credentialVersion: changedAt.getTime() - 1,
        },
      } as Parameters<typeof middleware>[0],
      response,
      ((value?: { status?: number }) => {
        if (value) error = value;
        else admitted = true;
      }) as NextFunction
    );

    assert.strictEqual(admitted, false);
    assert.strictEqual(error?.status, 403);
    mock.restoreAll();
  });
});
