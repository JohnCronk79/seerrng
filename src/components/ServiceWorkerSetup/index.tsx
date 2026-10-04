/* eslint-disable no-console */

import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from '@app/utils/localStorage';
import { verifyAndResubscribePushSubscription } from '@app/utils/pushSubscriptionHelpers';
import versionedAsset from '@app/utils/versionedAsset';
import { useEffect, useMemo } from 'react';

import {
  canRegisterServiceWorker,
  createServiceWorkerLifecycleGuard,
  getPushNotificationsEnabledStorageKey,
  postCacheUserToWorker,
  shouldVerifyPushSubscription,
  syncRegistrationCacheUser,
} from './registration';

const ServiceWorkerSetup = () => {
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const userId = user?.id;
  const cacheUser = useMemo(
    () =>
      user
        ? {
            id: user.id,
            permissions: user.permissions,
            userType: user.userType,
          }
        : undefined,
    [user]
  );
  const pushSettings = useMemo(
    () => ({
      enablePushRegistration: currentSettings.enablePushRegistration,
      vapidPublic: currentSettings.vapidPublic,
    }),
    [currentSettings.enablePushRegistration, currentSettings.vapidPublic]
  );

  useEffect(() => {
    if (!canRegisterServiceWorker(navigator)) {
      return;
    }

    const lifecycle = createServiceWorkerLifecycleGuard();

    const syncControllerCacheUser = () => {
      if (lifecycle.isActive()) {
        postCacheUserToWorker(navigator.serviceWorker.controller, cacheUser);
      }
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      syncControllerCacheUser
    );
    syncControllerCacheUser();

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          versionedAsset('/sw.js')
        );
        if (!lifecycle.isActive()) {
          return;
        }
        console.log(
          '[SW] Registration successful, scope is:',
          registration.scope
        );

        syncRegistrationCacheUser(registration, cacheUser);

        const pushPreferenceKey = getPushNotificationsEnabledStorageKey(userId);
        const pushNotificationsEnabled = pushPreferenceKey
          ? readLocalStorageValue(pushPreferenceKey) === 'true'
          : false;

        // Reset the notifications flag if permissions were revoked
        if (
          'Notification' in window &&
          Notification.permission !== 'granted' &&
          pushNotificationsEnabled
        ) {
          if (pushPreferenceKey) {
            writeLocalStorageValue(pushPreferenceKey, 'false');
          }
          console.warn(
            '[SW] Push permissions not granted — skipping resubscribe'
          );

          return;
        }

        // Bypass resubscribing if we have manually disabled push notifications
        if (
          !shouldVerifyPushSubscription({
            pushNotificationsEnabled,
            userId,
          })
        ) {
          return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (!lifecycle.isActive()) {
          return;
        }

        console.log('[SW] Existing push subscription:', subscription?.endpoint);

        const verified = await verifyAndResubscribePushSubscription(
          userId,
          pushSettings,
          lifecycle.isActive
        );
        if (!lifecycle.isActive()) {
          return;
        }

        if (verified) {
          console.log('[SW] Push subscription verified or refreshed.');
        } else {
          console.warn(
            '[SW] Push subscription verification failed or not available.'
          );
        }
      } catch (error) {
        if (lifecycle.isActive()) {
          console.log('[SW] Service worker registration failed, error:', error);
        }
      }
    };

    const cleanup = () => {
      lifecycle.cancel();
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        syncControllerCacheUser
      );
    };

    if ('requestIdleCallback' in window) {
      const idleCallback = window.requestIdleCallback(registerServiceWorker, {
        timeout: 5000,
      });

      return () => {
        window.cancelIdleCallback(idleCallback);
        cleanup();
      };
    }

    const timeout = globalThis.setTimeout(registerServiceWorker, 2000);

    return () => {
      globalThis.clearTimeout(timeout);
      cleanup();
    };
  }, [cacheUser, pushSettings, userId]);
  return null;
};

export default ServiceWorkerSetup;
