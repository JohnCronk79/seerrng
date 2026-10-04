export const canRegisterServiceWorker = (
  navigatorLike: Pick<Navigator, 'serviceWorker'> | undefined
) => Boolean(navigatorLike && 'serviceWorker' in navigatorLike);

export const shouldVerifyPushSubscription = ({
  pushNotificationsEnabled,
  userId,
}: {
  pushNotificationsEnabled: boolean;
  userId: number | undefined;
}) => Boolean(userId && pushNotificationsEnabled);

export const getPushNotificationsEnabledStorageKey = (
  userId: number | undefined
): string | undefined =>
  Number.isSafeInteger(userId) && (userId ?? 0) > 0
    ? `pushNotificationsEnabled:${userId}`
    : undefined;

export interface ServiceWorkerCacheUser {
  id: number;
  permissions: number;
  userType: number;
}

export const hasCurrentPushSubscription = (
  endpoint: string | undefined,
  devices: readonly { endpoint: string }[] | undefined
): boolean =>
  Boolean(endpoint && devices?.some((device) => device.endpoint === endpoint));

export const createServiceWorkerLifecycleGuard = () => {
  let active = true;
  return {
    isActive: () => active,
    cancel: () => {
      active = false;
    },
  };
};

export const createCacheUserMessage = (
  user: ServiceWorkerCacheUser | undefined
) => ({
  type: 'SET_CACHE_USER' as const,
  userId: user?.id ?? null,
  permissions: user?.permissions ?? null,
  userType: user?.userType ?? null,
});

export const postCacheUserToWorker = (
  worker: Pick<ServiceWorker, 'postMessage'> | null | undefined,
  user: ServiceWorkerCacheUser | undefined
) => worker?.postMessage(createCacheUserMessage(user));

export const syncRegistrationCacheUser = (
  registration: Pick<
    ServiceWorkerRegistration,
    'active' | 'installing' | 'waiting'
  >,
  user: ServiceWorkerCacheUser | undefined
) => {
  const workers = [
    registration.active,
    registration.waiting,
    registration.installing,
  ];

  workers.forEach((worker) => postCacheUserToWorker(worker, user));
};
