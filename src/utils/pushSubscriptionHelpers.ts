import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';

type PushSettings = Pick<
  PublicSettingsResponse,
  'enablePushRegistration' | 'vapidPublic'
>;

type PushSubscriptionResponse = {
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
};

// Taken from https://www.npmjs.com/package/web-push
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i)
    outputArray[i] = rawData.charCodeAt(i);

  return outputArray;
}

export const getPushSubscription = async () => {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { registration, subscription };
};

export const verifyPushSubscription = async (
  userId: number | undefined,
  currentSettings: PushSettings
): Promise<boolean> => {
  if (!('serviceWorker' in navigator) || !userId) {
    return false;
  }

  try {
    const { subscription } = await getPushSubscription();

    if (!subscription) {
      return false;
    }

    const appServerKey = subscription.options?.applicationServerKey;
    if (!(appServerKey instanceof ArrayBuffer)) {
      return false;
    }

    const currentServerKey = new Uint8Array(appServerKey).toString();
    const expectedServerKey = urlBase64ToUint8Array(
      currentSettings.vapidPublic
    ).toString();

    if (currentServerKey !== expectedServerKey) {
      return false;
    }

    const endpoint = subscription.endpoint;

    const { data } = await axios.get<PushSubscriptionResponse>(
      `/api/v1/user/${userId}/pushSubscription/${encodeURIComponent(endpoint)}`
    );

    return data.endpoint === endpoint;
  } catch {
    return false;
  }
};

export const verifyAndResubscribePushSubscription = async (
  userId: number | undefined,
  currentSettings: PushSettings,
  isCurrent: () => boolean = () => true
): Promise<boolean> => {
  if (!userId || !isCurrent()) {
    return false;
  }

  const { subscription } = await getPushSubscription();
  if (!isCurrent()) {
    return false;
  }
  const isValid = await verifyPushSubscription(userId, currentSettings);
  if (!isCurrent()) {
    return false;
  }

  if (isValid) {
    return true;
  }

  if (!currentSettings.enablePushRegistration) {
    return false;
  }

  try {
    const oldEndpoint = subscription?.endpoint;
    if (subscription) {
      await subscription.unsubscribe();
    }
    if (!isCurrent()) {
      return false;
    }

    const subscribedEndpoint = await subscribeToPushNotifications(
      userId,
      currentSettings,
      isCurrent
    );
    if (!subscribedEndpoint || !isCurrent()) {
      return false;
    }

    if (oldEndpoint && oldEndpoint !== subscribedEndpoint) {
      try {
        await axios.delete(
          `/api/v1/user/${userId}/pushSubscription/${encodeURIComponent(
            oldEndpoint
          )}`
        );
      } catch {
        // Ignore errors when deleting old endpoint (it might not exist)
      }
    }
    return true;
  } catch (error) {
    throw new Error(`[SW] Resubscribe failed: ${error.message}`, {
      cause: error,
    });
  }
};

export const subscribeToPushNotifications = async (
  userId: number | undefined,
  currentSettings: PushSettings,
  isCurrent: () => boolean = () => true
) => {
  if (
    !isCurrent() ||
    !('serviceWorker' in navigator) ||
    !userId ||
    !currentSettings.enablePushRegistration
  ) {
    return false;
  }

  let subscription: PushSubscription | undefined;
  try {
    const { registration } = await getPushSubscription();

    if (!registration || !isCurrent()) {
      return false;
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: currentSettings.vapidPublic,
    });

    if (!isCurrent()) {
      await subscription.unsubscribe().catch(() => false);
      return false;
    }

    const { keys } = subscription.toJSON();
    const endpoint = subscription.endpoint;

    if (endpoint && keys?.p256dh && keys?.auth) {
      if (!isCurrent()) {
        await subscription.unsubscribe().catch(() => false);
        return false;
      }
      await axios.post('/api/v1/user/registerPushSubscription', {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: navigator.userAgent,
      });

      if (!isCurrent()) {
        await subscription.unsubscribe().catch(() => false);
        return false;
      }

      return endpoint;
    }

    await subscription.unsubscribe().catch(() => false);
    return false;
  } catch (error) {
    if (subscription) {
      await subscription.unsubscribe().catch(() => false);
    }
    throw new Error(
      `Issue subscribing to push notifications: ${error.message}`,
      { cause: error }
    );
  }
};

export const unsubscribeToPushNotifications = async (
  userId: number | undefined,
  endpoint?: string
): Promise<string | null> => {
  if (!('serviceWorker' in navigator) || !userId) {
    return null;
  }

  try {
    const { subscription } = await getPushSubscription();

    if (!subscription) {
      return null;
    }

    const { endpoint: currentEndpoint } = subscription.toJSON();

    if (!endpoint || endpoint === currentEndpoint) {
      await subscription.unsubscribe();
      return currentEndpoint ?? null;
    }

    return null;
  } catch (error) {
    throw new Error(
      `Issue unsubscribing to push notifications: ${error.message}`,
      { cause: error }
    );
  }
};
