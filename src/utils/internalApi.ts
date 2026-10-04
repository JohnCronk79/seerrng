const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 5055;

export const INTERNAL_API_HTTP_OPTIONS = {
  timeout: 5_000,
  maxContentLength: 16 * 1024 * 1024,
  maxBodyLength: 1024 * 1024,
} as const;

export const encodeInternalApiPathSegment = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Internal API path parameter must be a scalar.');
  }

  return encodeURIComponent(String(value));
};

const normalizeInternalApiHost = (host?: string): string => {
  const candidate = host?.trim();
  if (
    !candidate ||
    candidate === '0.0.0.0' ||
    candidate === '::' ||
    candidate === '[::]'
  ) {
    return LOOPBACK_HOST;
  }

  const urlHost =
    candidate.includes(':') && !candidate.startsWith('[')
      ? `[${candidate}]`
      : candidate;

  try {
    const parsed = new URL(`http://${urlHost}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return LOOPBACK_HOST;
    }

    return parsed.hostname.includes(':')
      ? `[${parsed.hostname.replace(/^\[|\]$/g, '')}]`
      : parsed.hostname;
  } catch {
    return LOOPBACK_HOST;
  }
};

const normalizeInternalApiPort = (value?: string): number => {
  if (!value || !/^\d{1,5}$/.test(value)) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : DEFAULT_PORT;
};

export const getInternalApiBaseUrl = (): string => {
  const host = normalizeInternalApiHost(process.env.HOST);
  const port = normalizeInternalApiPort(process.env.PORT);

  return `http://${host}:${port}`;
};
