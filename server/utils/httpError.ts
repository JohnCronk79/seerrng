import axios, { type AxiosError } from 'axios';

export type HttpErrorDetails = {
  errorMessage: string;
  errorCode?: string;
  status?: number;
};

type ErrorWithCause = {
  cause?: unknown;
};

const findAxiosError = (error: unknown): AxiosError | undefined => {
  let current = error;
  const seen = new Set<object>();

  for (
    let depth = 0;
    current !== undefined && current !== null && depth < 8;
    depth++
  ) {
    if (axios.isAxiosError(current)) {
      return current;
    }

    if (typeof current !== 'object') {
      return undefined;
    }
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    current = (current as ErrorWithCause).cause;
  }

  return undefined;
};

const getRetryAfterHeader = (error: unknown): string | undefined => {
  let current = error;
  const seen = new Set<object>();

  for (
    let depth = 0;
    current !== undefined && current !== null && depth < 8;
    depth++
  ) {
    if (typeof current !== 'object') {
      return undefined;
    }
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);

    const response = (
      current as {
        response?: {
          headers?: Record<string, unknown> & {
            get?: (name: string) => unknown;
          };
        };
      }
    ).response;
    const headers = response?.headers;
    const header =
      headers?.['retry-after'] ??
      headers?.['Retry-After'] ??
      headers?.get?.('retry-after');
    if (Array.isArray(header)) {
      return typeof header[0] === 'string' ? header[0] : undefined;
    }
    if (typeof header === 'string') {
      return header;
    }

    current = (current as ErrorWithCause).cause;
  }

  return undefined;
};

export const getRetryAfterMs = (error: unknown): number | undefined => {
  const value = getRetryAfterHeader(error)?.trim();
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.min(seconds * 1000, 10_000) : undefined;
  }

  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.min(Math.max(date - Date.now(), 0), 10_000);
};

export const getHttpErrorDetails = (error: unknown): HttpErrorDetails => {
  const axiosError = findAxiosError(error);
  if (axiosError) {
    return {
      errorMessage:
        error instanceof Error
          ? error.message || error.name || 'Unknown HTTP error'
          : axiosError.message || axiosError.name || 'Unknown HTTP error',
      ...(axiosError.code ? { errorCode: axiosError.code } : {}),
      ...(axiosError.response?.status
        ? { status: axiosError.response.status }
        : {}),
    };
  }

  if (error instanceof Error) {
    return {
      errorMessage: error.message || error.name || 'Unknown error',
    };
  }

  return {
    errorMessage: String(error || 'Unknown error'),
  };
};

export const hasHttpStatus = (
  error: unknown,
  expectedStatus: number
): boolean => {
  if (
    !Number.isInteger(expectedStatus) ||
    expectedStatus < 100 ||
    expectedStatus > 599
  ) {
    return false;
  }

  let current = error;
  const seen = new Set<object>();

  for (
    let depth = 0;
    current !== undefined && current !== null && depth < 8;
    depth++
  ) {
    if (typeof current === 'object') {
      if (seen.has(current)) {
        return false;
      }
      seen.add(current);
    }

    if (
      axios.isAxiosError(current) &&
      current.response?.status === expectedStatus
    ) {
      return true;
    }

    const record =
      typeof current === 'object'
        ? (current as {
            status?: unknown;
            statusCode?: unknown;
            cause?: unknown;
            response?: { status?: unknown };
          })
        : undefined;
    if (
      record?.status === expectedStatus ||
      record?.statusCode === expectedStatus ||
      record?.response?.status === expectedStatus
    ) {
      return true;
    }

    const message =
      current instanceof Error
        ? current.message
        : typeof current === 'string'
          ? current
          : '';
    if (
      message.trim() === String(expectedStatus) ||
      new RegExp(
        `(?:http|status(?:\\s+code)?)\\D{0,20}${expectedStatus}(?:\\D|$)`,
        'i'
      ).test(message)
    ) {
      return true;
    }

    current = record?.cause;
  }

  return false;
};

export const isTransientHttpError = (error: unknown): boolean => {
  const axiosError = findAxiosError(error);
  if (!axiosError) {
    return false;
  }

  const status = axiosError.response?.status;

  return (
    status === undefined || status === 408 || status === 429 || status >= 500
  );
};

export const withTransientHttpRetry = async <T>(
  request: () => Promise<T>,
  {
    maxAttempts = 2,
    delayMs = 250,
    onRetry,
  }: {
    maxAttempts?: number;
    delayMs?: number;
    onRetry?: (error: unknown, nextAttempt: number) => void;
  } = {}
): Promise<T> => {
  let attempt = 1;

  while (true) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientHttpError(error)) {
        throw error;
      }

      attempt += 1;
      onRetry?.(error, attempt);
      const retryDelay =
        getRetryAfterMs(error) ??
        Math.min(Math.max(delayMs, 0) * 2 ** (attempt - 2), 10_000);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
};
