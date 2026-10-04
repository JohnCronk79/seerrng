import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRegisterServiceWorker,
  createCacheUserMessage,
  createServiceWorkerLifecycleGuard,
  getPushNotificationsEnabledStorageKey,
  hasCurrentPushSubscription,
  postCacheUserToWorker,
  shouldVerifyPushSubscription,
  syncRegistrationCacheUser,
} from './registration';

describe('canRegisterServiceWorker', () => {
  it('allows service worker registration without a logged-in user', () => {
    assert.equal(
      canRegisterServiceWorker({
        serviceWorker: {},
      } as Pick<Navigator, 'serviceWorker'>),
      true
    );
  });

  it('skips registration when the browser does not support service workers', () => {
    assert.equal(
      canRegisterServiceWorker({} as Pick<Navigator, 'serviceWorker'>),
      false
    );
    assert.equal(canRegisterServiceWorker(undefined), false);
  });
});

describe('shouldVerifyPushSubscription', () => {
  it('keeps push resubscribe gated by user and local preference', () => {
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: 1,
      }),
      true
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: undefined,
      }),
      false
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: false,
        userId: 1,
      }),
      false
    );
  });
});

describe('push preference partition', () => {
  it('uses a distinct storage key for each valid user', () => {
    assert.strictEqual(
      getPushNotificationsEnabledStorageKey(1),
      'pushNotificationsEnabled:1'
    );
    assert.strictEqual(
      getPushNotificationsEnabledStorageKey(2),
      'pushNotificationsEnabled:2'
    );
    assert.strictEqual(
      getPushNotificationsEnabledStorageKey(undefined),
      undefined
    );
    assert.strictEqual(getPushNotificationsEnabledStorageKey(0), undefined);
  });
});

describe('push subscription ownership', () => {
  it('requires an exact endpoint owned by the current user', () => {
    const devices = [{ endpoint: 'https://push.example/current' }];
    assert.strictEqual(
      hasCurrentPushSubscription('https://push.example/current', devices),
      true
    );
    assert.strictEqual(
      hasCurrentPushSubscription('https://push.example/other', devices),
      false
    );
    assert.strictEqual(hasCurrentPushSubscription(undefined, devices), false);
  });
});

describe('service worker cache user partition', () => {
  it('invalidates asynchronous work when an effect lifecycle ends', () => {
    const lifecycle = createServiceWorkerLifecycleGuard();
    assert.strictEqual(lifecycle.isActive(), true);
    lifecycle.cancel();
    assert.strictEqual(lifecycle.isActive(), false);
    lifecycle.cancel();
    assert.strictEqual(lifecycle.isActive(), false);
  });

  it('uses an explicit null partition when no user is authenticated', () => {
    assert.deepEqual(createCacheUserMessage(undefined), {
      type: 'SET_CACHE_USER',
      userId: null,
      permissions: null,
      userType: null,
    });
  });

  it('posts the current user to each worker lifecycle state', () => {
    const messages: unknown[] = [];
    const worker = {
      postMessage: (message: unknown) => messages.push(message),
    } as Pick<ServiceWorker, 'postMessage'>;

    syncRegistrationCacheUser(
      {
        active: worker as ServiceWorker,
        waiting: worker as ServiceWorker,
        installing: null,
      },
      { id: 42, permissions: 8, userType: 2 }
    );

    assert.deepEqual(messages, [
      {
        type: 'SET_CACHE_USER',
        userId: 42,
        permissions: 8,
        userType: 2,
      },
      {
        type: 'SET_CACHE_USER',
        userId: 42,
        permissions: 8,
        userType: 2,
      },
    ]);
  });

  it('does nothing when there is no controlling worker', () => {
    assert.equal(
      postCacheUserToWorker(null, {
        id: 42,
        permissions: 8,
        userType: 2,
      }),
      undefined
    );
  });
});
