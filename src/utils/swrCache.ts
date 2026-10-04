import { useEffect, useState } from 'react';
import type { Cache } from 'swr';
import {
  readLocalStoredRecord,
  removeLocalStorageValue,
  writeLocalStoredRecord,
} from './localStorage';

const RESPONSE_CACHE_PREFIX = 'seerr-response-cache-v1:';
const MAX_RESPONSE_CACHE_AGE = 1000 * 60 * 60 * 24;

const getResponseCacheKey = (key: string) =>
  `${RESPONSE_CACHE_PREFIX}${encodeURIComponent(key)}`;

export const getPersistentResponse = <T>(key: string): T | undefined => {
  const cacheKey = getResponseCacheKey(key);
  const record = readLocalStoredRecord(cacheKey);

  if (
    !record ||
    typeof record.timestamp !== 'number' ||
    !Number.isFinite(record.timestamp) ||
    !Object.prototype.hasOwnProperty.call(record, 'data')
  ) {
    removeLocalStorageValue(cacheKey);
    return undefined;
  }

  const now = Date.now();
  if (
    record.timestamp > now ||
    now - record.timestamp > MAX_RESPONSE_CACHE_AGE
  ) {
    removeLocalStorageValue(cacheKey);
    return undefined;
  }

  return record.data as T;
};

export const setPersistentResponse = <T>(key: string, data: T | undefined) => {
  if (data === undefined) {
    return;
  }

  writeLocalStoredRecord(getResponseCacheKey(key), {
    timestamp: Date.now(),
    data,
  });
};

export const usePersistentResponse = <T>(key: string): T | undefined => {
  const [response, setResponse] = useState<{ key: string; data?: T }>();

  useEffect(() => {
    setResponse({ key, data: getPersistentResponse<T>(key) });
  }, [key]);

  return response?.key === key ? response.data : undefined;
};

// SWR's shared in-memory cache handles navigation deduplication. Persisted
// discover fallbacks are restored explicitly after hydration above; storing
// every authenticated API response in localStorage risks stale cross-user data.
export const createPersistentSWRCache = (): Cache =>
  new Map<string, unknown>() as Cache;
