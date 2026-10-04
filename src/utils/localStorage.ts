export type StorageReader = Pick<Storage, 'getItem'>;
export type StorageWriter = Pick<Storage, 'setItem'>;

export const getBrowserStorage = (
  accessor: () => Storage
): Storage | undefined => {
  try {
    return accessor();
  } catch {
    return undefined;
  }
};

export const getLocalStorage = (): Storage | undefined =>
  typeof window === 'undefined'
    ? undefined
    : getBrowserStorage(() => window.localStorage);

export const getSessionStorage = (): Storage | undefined =>
  typeof window === 'undefined'
    ? undefined
    : getBrowserStorage(() => window.sessionStorage);

export const readStoredValue = (
  storage: StorageReader | undefined,
  key: string
): string | null | undefined => {
  try {
    return storage?.getItem(key);
  } catch {
    return undefined;
  }
};

export const writeStoredValue = (
  storage: StorageWriter | undefined,
  key: string,
  value: string
): boolean => {
  try {
    if (!storage) {
      return false;
    }
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const readStoredRecord = (
  storage: StorageReader,
  key: string
): Record<string, unknown> | undefined => {
  try {
    const serialized = storage.getItem(key);
    if (!serialized) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(serialized);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export const readLocalStoredRecord = (
  key: string
): Record<string, unknown> | undefined => {
  const storage = getLocalStorage();
  return storage ? readStoredRecord(storage, key) : undefined;
};

export const writeStoredRecord = (
  storage: StorageWriter,
  key: string,
  value: Record<string, unknown>
): boolean => {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const writeLocalStoredRecord = (
  key: string,
  value: Record<string, unknown>
): boolean => {
  const storage = getLocalStorage();
  return storage ? writeStoredRecord(storage, key, value) : false;
};

export const readLocalStorageValue = (key: string): string | null | undefined =>
  readStoredValue(getLocalStorage(), key);

export const writeLocalStorageValue = (key: string, value: string): boolean =>
  writeStoredValue(getLocalStorage(), key, value);

export const removeLocalStorageValue = (key: string): boolean => {
  try {
    const storage = getLocalStorage();
    if (!storage) {
      return false;
    }
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const readSessionStorageValue = (
  key: string
): string | null | undefined => readStoredValue(getSessionStorage(), key);

export const writeSessionStorageValue = (key: string, value: string): boolean =>
  writeStoredValue(getSessionStorage(), key, value);

export const removeSessionStorageValue = (key: string): boolean => {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return false;
    }
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const isStoredOption = <Option extends string>(
  value: unknown,
  options: readonly Option[]
): value is Option =>
  typeof value === 'string' && options.includes(value as Option);

export const isStoredPageSize = (
  value: unknown,
  options: readonly number[] = [5, 10, 25, 50, 100]
): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  options.includes(value);
