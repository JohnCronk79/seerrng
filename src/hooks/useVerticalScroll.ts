import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const IS_SCROLLING_CHECK_THROTTLE = 200;
const BOTTOM_RECHECK_INTERVAL = 500;

/**
 * useVerticalScroll is a custom hook to handle infinite scrolling
 *
 * @param callback Callback is executed when page reaches bottom
 * @param shouldFetch Disables callback if true
 */
const useVerticalScroll = (
  callback: () => void,
  shouldFetch: boolean
): boolean => {
  const [isScrolling, setScrolling] = useState(false);
  const isScrollingRef = useRef(false);

  type SetTimeoutReturnType = ReturnType<typeof setTimeout>;
  const scrollingTimer: MutableRefObject<SetTimeoutReturnType | undefined> =
    useRef(undefined);
  const callbackTimer: MutableRefObject<SetTimeoutReturnType | undefined> =
    useRef(undefined);

  const runCallback = useCallback(() => {
    if (shouldFetch) {
      const scrollTop = Math.max(
        window.pageYOffset,
        document.documentElement.scrollTop,
        document.body.scrollTop
      );
      if (
        window.innerHeight + scrollTop >=
        document.documentElement.offsetHeight - window.innerHeight
      ) {
        callback();
      }
    }
  }, [callback, shouldFetch]);

  const debouncedCallback = useCallback(() => {
    if (callbackTimer.current !== undefined) {
      clearTimeout(callbackTimer.current);
    }

    callbackTimer.current = setTimeout(runCallback, 50);
  }, [runCallback]);

  useEffect(() => {
    runCallback();
  }, [runCallback]);

  useEffect(() => {
    if (!shouldFetch) {
      return;
    }

    const interval = setInterval(runCallback, BOTTOM_RECHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [runCallback, shouldFetch]);

  useEffect(() => {
    const onScroll = () => {
      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }

      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        setScrolling(true);
      }

      scrollingTimer.current = setTimeout(() => {
        isScrollingRef.current = false;
        setScrolling(false);
      }, IS_SCROLLING_CHECK_THROTTLE);
      debouncedCallback();
    };

    const onResize = () => {
      debouncedCallback();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);

      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }
      if (callbackTimer.current !== undefined) {
        clearTimeout(callbackTimer.current);
      }
    };
  }, [debouncedCallback]);

  return isScrolling;
};

export default useVerticalScroll;
