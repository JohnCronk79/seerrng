import type { RestorableDiscoverMediaType } from '@app/utils/discoverScrollRestoration';
import {
  getScrollRestorationAction,
  isMediaDetailPath,
  readDiscoverScrollEntry,
  saveDiscoverScrollEntry,
} from '@app/utils/discoverScrollRestoration';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

type UseDiscoverScrollRestorationOptions = {
  mediaType: RestorableDiscoverMediaType;
  shuffleSeed?: string;
  itemCount: number;
  isLoading: boolean;
  isReachingEnd: boolean;
  fetchMore: () => void;
};

const useDiscoverScrollRestoration = ({
  mediaType,
  shuffleSeed,
  itemCount,
  isLoading,
  isReachingEnd,
  fetchMore,
}: UseDiscoverScrollRestorationOptions): void => {
  const router = useRouter();
  const itemCountRef = useRef(itemCount);
  const loadRequestedRef = useRef<number | undefined>(undefined);
  const [entry, setEntry] = useState(() =>
    typeof window === 'undefined'
      ? undefined
      : readDiscoverScrollEntry(router.asPath)
  );

  itemCountRef.current = itemCount;

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    setEntry(readDiscoverScrollEntry(router.asPath));
  }, [router.asPath, router.isReady]);

  useEffect(() => {
    const saveScrollPosition = (url: string) => {
      if (!isMediaDetailPath(url, mediaType)) {
        return;
      }

      saveDiscoverScrollEntry({
        path: router.asPath,
        scrollY: window.scrollY,
        itemCount: itemCountRef.current,
        shuffleSeed,
      });
    };

    router.events.on('routeChangeStart', saveScrollPosition);

    return () => router.events.off('routeChangeStart', saveScrollPosition);
  }, [mediaType, router.asPath, router.events, shuffleSeed]);

  useEffect(() => {
    if (isLoading) {
      loadRequestedRef.current = undefined;
      return;
    }

    const action = getScrollRestorationAction({
      entry,
      itemCount,
      isLoading,
      isReachingEnd,
    });

    if (action === 'load-more') {
      if (loadRequestedRef.current !== itemCount) {
        loadRequestedRef.current = itemCount;
        fetchMore();
      }

      return;
    }

    if (action !== 'restore' || !entry) {
      return;
    }

    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: entry.scrollY, left: 0, behavior: 'auto' });
        setEntry(undefined);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [entry, fetchMore, isLoading, isReachingEnd, itemCount]);
};

export default useDiscoverScrollRestoration;
