import {
  clearRequestStatusScrollEntry,
  isRequestDetailPath,
  readRequestStatusScrollEntry,
  saveRequestStatusScrollEntry,
} from '@app/utils/requestStatusScrollRestoration';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const useRequestStatusScrollRestoration = (isReady: boolean): void => {
  const router = useRouter();
  const [scrollY, setScrollY] = useState<number>();

  useEffect(() => {
    if (!router.isReady) return;

    setScrollY(readRequestStatusScrollEntry(router.asPath)?.scrollY);
  }, [router.asPath, router.isReady]);

  useEffect(() => {
    const saveScrollPosition = (url: string) => {
      if (!isRequestDetailPath(url)) return;

      saveRequestStatusScrollEntry({
        path: router.asPath,
        scrollY: window.scrollY,
      });
    };

    router.events.on('routeChangeStart', saveScrollPosition);

    return () => router.events.off('routeChangeStart', saveScrollPosition);
  }, [router.asPath, router.events]);

  useEffect(() => {
    if (!isReady || scrollY === undefined) return;

    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
        clearRequestStatusScrollEntry();
        setScrollY(undefined);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [isReady, scrollY]);
};

export default useRequestStatusScrollRestoration;
