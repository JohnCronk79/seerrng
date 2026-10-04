import { useEffect, useSyncExternalStore } from 'react';

let searchActive = false;
const activeSources = new Set<string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSearchActivitySnapshot = () => searchActive;
const getServerSnapshot = () => false;

export const setSearchActivity = (
  active: boolean,
  source = 'global-search'
): void => {
  if (active) {
    activeSources.add(source);
  } else {
    activeSources.delete(source);
  }

  const nextSearchActive = activeSources.size > 0;
  if (searchActive === nextSearchActive) {
    return;
  }

  searchActive = nextSearchActive;
  listeners.forEach((listener) => listener());
};

export const useSearchActivityReporter = (
  active: boolean,
  source: string
): void => {
  useEffect(() => {
    setSearchActivity(active, source);

    return () => setSearchActivity(false, source);
  }, [active, source]);
};

const useSearchActivity = (): boolean =>
  useSyncExternalStore(subscribe, getSearchActivitySnapshot, getServerSnapshot);

export default useSearchActivity;
