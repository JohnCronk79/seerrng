export type RequestStatusScrollEntry = {
  path: string;
  scrollY: number;
};

export const REQUEST_STATUS_SCROLL_KEY = '__seerrRequestStatusScroll';

const requestDetailPath = /^\/(?:movie|tv|music|book)\/[^/?#]+(?:[/?#]|$)/;

export const isRequestDetailPath = (url: string): boolean => {
  const path = url.startsWith('http') ? new URL(url).pathname : url;

  return requestDetailPath.test(path);
};

const storageKey = (): string | undefined => {
  const key = window.history.state?.key;
  return typeof key === 'string'
    ? `${REQUEST_STATUS_SCROLL_KEY}:${key}`
    : undefined;
};

export const readRequestStatusScrollEntry = (
  path: string
): RequestStatusScrollEntry | undefined => {
  if (typeof window === 'undefined') return undefined;

  try {
    const key = storageKey();
    if (!key) return undefined;

    const entry = JSON.parse(
      window.sessionStorage.getItem(key) ?? 'null'
    ) as Partial<RequestStatusScrollEntry> | null;

    if (
      !entry ||
      entry.path !== path ||
      typeof entry.scrollY !== 'number' ||
      !Number.isFinite(entry.scrollY) ||
      entry.scrollY < 0
    ) {
      return undefined;
    }

    return entry as RequestStatusScrollEntry;
  } catch {
    return undefined;
  }
};

export const saveRequestStatusScrollEntry = (
  entry: RequestStatusScrollEntry
): void => {
  try {
    const key = storageKey();
    if (key) window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Navigation must still work when session storage is unavailable.
  }
};

export const clearRequestStatusScrollEntry = (): void => {
  try {
    const key = storageKey();
    if (key) window.sessionStorage.removeItem(key);
  } catch {
    // Restoration is optional when session storage is unavailable.
  }
};
