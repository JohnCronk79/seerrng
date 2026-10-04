import axios from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  subscribeToPushNotifications,
  verifyAndResubscribePushSubscription,
} from './pushSubscriptionHelpers';

const pushSettings = {
  enablePushRegistration: true,
  vapidPublic: 'unused-when-stale',
};

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window'
);
const originalAxiosPost = axios.post;
const originalAxiosDelete = axios.delete;

afterEach(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
  axios.post = originalAxiosPost;
  axios.delete = originalAxiosDelete;
});

describe('push subscription lifecycle authority', () => {
  it('does no browser or network work for a stale lifecycle', async () => {
    const isCurrent = () => false;
    assert.strictEqual(
      await subscribeToPushNotifications(1, pushSettings, isCurrent),
      false
    );
    assert.strictEqual(
      await verifyAndResubscribePushSubscription(1, pushSettings, isCurrent),
      false
    );
  });

  it('replaces an invalid existing subscription and removes its old endpoint', async () => {
    let unsubscribeCalls = 0;
    let subscribeCalls = 0;
    const staleSubscription = {
      endpoint: 'https://push.example/old',
      options: { applicationServerKey: null },
      unsubscribe: async () => {
        unsubscribeCalls += 1;
        return true;
      },
    } as unknown as PushSubscription;
    const replacementSubscription = {
      endpoint: 'https://push.example/new',
      toJSON: () => ({
        endpoint: 'https://push.example/new',
        keys: { auth: 'auth', p256dh: 'key' },
      }),
      unsubscribe: async () => true,
    } as unknown as PushSubscription;
    const registration = {
      pushManager: {
        getSubscription: async () => staleSubscription,
        subscribe: async () => {
          subscribeCalls += 1;
          return replacementSubscription;
        },
      },
    } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: { ready: Promise.resolve(registration) },
        userAgent: 'test-agent',
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { atob: globalThis.atob },
    });

    const posts: unknown[] = [];
    const deletes: string[] = [];
    axios.post = (async (_url: string, body: unknown) => {
      posts.push(body);
    }) as typeof axios.post;
    axios.delete = (async (url: string) => {
      deletes.push(url);
    }) as typeof axios.delete;

    assert.strictEqual(
      await verifyAndResubscribePushSubscription(7, pushSettings),
      true
    );
    assert.strictEqual(unsubscribeCalls, 1);
    assert.strictEqual(subscribeCalls, 1);
    assert.deepStrictEqual(posts, [
      {
        endpoint: 'https://push.example/new',
        p256dh: 'key',
        auth: 'auth',
        userAgent: 'test-agent',
      },
    ]);
    assert.deepStrictEqual(deletes, [
      '/api/v1/user/7/pushSubscription/https%3A%2F%2Fpush.example%2Fold',
    ]);
  });

  it('rolls back a browser subscription when server registration fails', async () => {
    let unsubscribeCalls = 0;
    const subscription = {
      endpoint: 'https://push.example/rollback',
      toJSON: () => ({ keys: { auth: 'auth', p256dh: 'key' } }),
      unsubscribe: async () => {
        unsubscribeCalls += 1;
        return true;
      },
    } as unknown as PushSubscription;
    const registration = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => subscription,
      },
    } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: { ready: Promise.resolve(registration) },
        userAgent: 'test-agent',
      },
    });
    axios.post = (async () => {
      throw new Error('registration failed');
    }) as typeof axios.post;

    await assert.rejects(
      subscribeToPushNotifications(7, pushSettings),
      /Issue subscribing to push notifications/
    );
    assert.strictEqual(unsubscribeCalls, 1);
  });
});
