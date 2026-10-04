import type { DiscoverHomeManifest } from '@server/interfaces/api/discoverHomeInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

const MANIFEST_URL = '/api/v1/discover/home/manifest';
const MANIFEST_CACHE_PREFIX = 'seerr-discover-manifest-v1:';
const MAX_MANIFEST_ROWS = 500;
const MAX_MANIFEST_FRESHNESS_SECONDS = 24 * 60 * 60;
const MAX_MANIFEST_TEXT_LENGTH = 4096;
const MAX_MANIFEST_REVISION_LENGTH = 128;
const MAX_MANIFEST_ETAG_LENGTH = 512;

interface ManifestCacheRecord {
  contextKey: string;
  checkedAt: number;
  etag?: string;
  manifest: DiscoverHomeManifest;
}

const getStorage = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const getManifestCacheKey = (contextKey: string) =>
  `${MANIFEST_CACHE_PREFIX}${encodeURIComponent(contextKey)}`;

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length <= maxLength;

const isFreshnessSeconds = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= MAX_MANIFEST_FRESHNESS_SECONDS;

export const parseDiscoverHomeManifest = (
  value: unknown
): DiscoverHomeManifest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const manifest = value as Partial<DiscoverHomeManifest>;
  const freshness = manifest.freshness;
  if (
    manifest.version !== 1 ||
    !isBoundedString(manifest.layoutRevision, MAX_MANIFEST_REVISION_LENGTH) ||
    !isBoundedString(
      manifest.userStateRevision,
      MAX_MANIFEST_REVISION_LENGTH
    ) ||
    !isBoundedString(manifest.generatedAt, 128) ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !freshness ||
    !isFreshnessSeconds(freshness.manifestMaxAgeSeconds) ||
    !isFreshnessSeconds(freshness.rowMaxAgeSeconds) ||
    !isFreshnessSeconds(freshness.stateMaxAgeSeconds) ||
    !Array.isArray(manifest.rows) ||
    manifest.rows.length > MAX_MANIFEST_ROWS
  ) {
    return undefined;
  }

  for (const row of manifest.rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      !isBoundedString(row.key, 256) ||
      !Number.isSafeInteger(row.sliderId) ||
      row.sliderId <= 0 ||
      !Number.isSafeInteger(row.type) ||
      row.type < 0 ||
      !isBoundedString(row.descriptorRevision, MAX_MANIFEST_REVISION_LENGTH) ||
      (row.title !== undefined &&
        !isBoundedString(row.title, MAX_MANIFEST_TEXT_LENGTH)) ||
      (row.data !== undefined &&
        !isBoundedString(row.data, MAX_MANIFEST_TEXT_LENGTH)) ||
      (row.endpoint !== undefined &&
        (!isBoundedString(row.endpoint, 2048) ||
          !row.endpoint.startsWith('/api/v1/') ||
          row.endpoint.startsWith('//')))
    ) {
      return undefined;
    }
  }

  return manifest as DiscoverHomeManifest;
};

export const readManifestCache = (
  storage: Pick<Storage, 'getItem'>,
  contextKey: string,
  now = Date.now()
): ManifestCacheRecord | undefined => {
  try {
    const rawRecord = storage.getItem(getManifestCacheKey(contextKey));
    const parsed: unknown = rawRecord ? JSON.parse(rawRecord) : undefined;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Partial<ManifestCacheRecord>;
    const manifest = parseDiscoverHomeManifest(record.manifest);
    return record.contextKey === contextKey &&
      typeof record.checkedAt === 'number' &&
      Number.isFinite(record.checkedAt) &&
      record.checkedAt >= 0 &&
      record.checkedAt <= now &&
      (record.etag === undefined ||
        isBoundedString(record.etag, MAX_MANIFEST_ETAG_LENGTH)) &&
      manifest
      ? {
          contextKey,
          checkedAt: record.checkedAt,
          etag: record.etag,
          manifest,
        }
      : undefined;
  } catch {
    return undefined;
  }
};

export const isManifestCacheFresh = (
  record: ManifestCacheRecord,
  now = Date.now()
) =>
  record.checkedAt + record.manifest.freshness.manifestMaxAgeSeconds * 1000 >
  now;

const writeManifestCache = (
  storage: Pick<Storage, 'setItem'>,
  contextKey: string,
  record: ManifestCacheRecord
) => {
  try {
    storage.setItem(getManifestCacheKey(contextKey), JSON.stringify(record));
  } catch {
    // The manifest is only an optimization; SWR still retains the live value.
  }
};

const useDiscoverHomeManifest = (contextKey: string | undefined) => {
  const [cachedResponse, setCachedResponse] = useState<{
    contextKey?: string;
    record?: ManifestCacheRecord;
  }>();

  useEffect(() => {
    const storage = getStorage();
    setCachedResponse({
      contextKey,
      record:
        storage && contextKey
          ? readManifestCache(storage, contextKey)
          : undefined,
    });
  }, [contextKey]);

  const hydrated = cachedResponse?.contextKey === contextKey;
  const cachedRecord = hydrated ? cachedResponse?.record : undefined;
  const { data, error } = useSWR<DiscoverHomeManifest>(
    hydrated && contextKey ? [MANIFEST_URL, contextKey] : null,
    {
      fallbackData: cachedRecord?.manifest,
      fetcher: async () => {
        const storage = getStorage();
        const currentRecord =
          storage && contextKey
            ? readManifestCache(storage, contextKey)
            : undefined;
        const response = await axios.get<DiscoverHomeManifest>(MANIFEST_URL, {
          headers: currentRecord?.etag
            ? { 'If-None-Match': currentRecord.etag }
            : undefined,
          validateStatus: (status) => status === 200 || status === 304,
        });
        const responseManifest =
          response.status === 304 && currentRecord
            ? currentRecord.manifest
            : parseDiscoverHomeManifest(response.data);
        if (!responseManifest) {
          throw new Error('Invalid Discover manifest response.');
        }
        const record: ManifestCacheRecord = {
          contextKey: contextKey!,
          checkedAt: Date.now(),
          etag: isBoundedString(response.headers.etag, MAX_MANIFEST_ETAG_LENGTH)
            ? response.headers.etag
            : currentRecord?.etag,
          manifest: responseManifest,
        };

        if (storage) {
          writeManifestCache(storage, contextKey!, record);
        }

        return record.manifest;
      },
      revalidateOnFocus: false,
      revalidateOnMount: !cachedRecord || !isManifestCacheFresh(cachedRecord),
      refreshInterval: (latestManifest) =>
        (latestManifest?.freshness.manifestMaxAgeSeconds ?? 60) * 1000,
      refreshWhenHidden: false,
    }
  );

  return { manifest: data, error };
};

export default useDiscoverHomeManifest;
