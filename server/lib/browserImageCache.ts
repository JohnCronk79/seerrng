export const BROWSER_IMAGE_CACHE_MAX_AGE = 7 * 24 * 60 * 60;
export const BROWSER_IMAGE_IMMUTABLE_CACHE_MAX_AGE = 30 * 24 * 60 * 60;
export const BROWSER_IMAGE_STALE_WHILE_REVALIDATE = 30 * 24 * 60 * 60;
export const BROWSER_IMAGE_STALE_IF_ERROR = 7 * 24 * 60 * 60;
const BROWSER_IMAGE_DEFAULT_MAX_AGE = 24 * 60 * 60;
const MAX_CONDITIONAL_HEADER_LENGTH = 1024;
const MAX_ETAG_CANDIDATES = 32;

const getSafeConditionalHeaderValues = (
  value: string | string[] | undefined
): string[] => {
  if (!value) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];

  return values.filter(
    (candidate) =>
      typeof candidate === 'string' &&
      candidate.length <= MAX_CONDITIONAL_HEADER_LENGTH &&
      !/[\r\n]/.test(candidate)
  );
};

export const getBrowserImageCacheControl = (
  originMaxAge: number,
  options: { immutable?: boolean } = {}
): string => {
  const safeOriginMaxAge =
    Number.isFinite(originMaxAge) && originMaxAge > 0
      ? originMaxAge
      : BROWSER_IMAGE_DEFAULT_MAX_AGE;
  const maxAge = options.immutable
    ? BROWSER_IMAGE_IMMUTABLE_CACHE_MAX_AGE
    : Math.min(safeOriginMaxAge, BROWSER_IMAGE_CACHE_MAX_AGE);

  const directives = [
    'public',
    `max-age=${maxAge}`,
    `stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}`,
    `stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}`,
  ];

  if (options.immutable) {
    directives.push('immutable');
  }

  return directives.join(', ');
};

export const getBrowserImageResponseHeaders = ({
  cacheKey,
  cacheMiss,
  etag,
  immutable,
  lastModified,
  maxAge,
}: {
  cacheKey: string;
  cacheMiss: boolean;
  etag: string;
  immutable?: boolean;
  lastModified?: number;
  maxAge: number;
}): Record<string, string> => {
  const headers: Record<string, string> = {
    'Cache-Control': getBrowserImageCacheControl(maxAge, { immutable }),
    ETag: etag,
    'OS-Cache-Key': cacheKey,
    'OS-Cache-Status': cacheMiss ? 'MISS' : 'HIT',
    Vary: 'Accept-Encoding',
  };

  if (lastModified && Number.isFinite(lastModified)) {
    headers['Last-Modified'] = new Date(lastModified).toUTCString();
  }

  return headers;
};

export const doesBrowserImageEtagMatch = (
  ifNoneMatch: string | string[] | undefined,
  etag: string
): boolean => {
  if (!ifNoneMatch) {
    return false;
  }

  const values = getSafeConditionalHeaderValues(ifNoneMatch);
  const normalizedEtag = etag.replace(/^W\//, '');

  return values.some((value) =>
    value
      .split(',')
      .slice(0, MAX_ETAG_CANDIDATES)
      .map((candidate) => candidate.trim())
      .map((candidate) => candidate.replace(/^W\//, ''))
      .some((candidate) => candidate === '*' || candidate === normalizedEtag)
  );
};

export const doesBrowserImageLastModifiedMatch = (
  ifModifiedSince: string | string[] | undefined,
  lastModified: number | undefined
): boolean => {
  if (!ifModifiedSince || !lastModified || !Number.isFinite(lastModified)) {
    return false;
  }

  const values = getSafeConditionalHeaderValues(ifModifiedSince);

  return values.some((value) => {
    const parsed = Date.parse(value);

    return (
      Number.isFinite(parsed) &&
      parsed >= Math.floor(lastModified / 1000) * 1000
    );
  });
};

export const shouldSendBrowserImageNotModified = ({
  etag,
  ifModifiedSince,
  ifNoneMatch,
  lastModified,
}: {
  etag: string;
  ifModifiedSince: string | string[] | undefined;
  ifNoneMatch: string | string[] | undefined;
  lastModified: number | undefined;
}): boolean => {
  if (ifNoneMatch) {
    return doesBrowserImageEtagMatch(ifNoneMatch, etag);
  }

  return doesBrowserImageLastModifiedMatch(ifModifiedSince, lastModified);
};
