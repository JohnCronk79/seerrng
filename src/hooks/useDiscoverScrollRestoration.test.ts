import { readDiscoverScrollEntry } from '@app/utils/discoverScrollRestoration';
import { JSDOM } from 'jsdom';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useDiscoverScrollRestoration from './useDiscoverScrollRestoration';

describe('discover Back navigation', () => {
  for (const [tab, mediaType] of [
    ['movies', 'movie'],
    ['tv', 'tv'],
    ['books', 'book'],
  ] as const) {
    it(`restores ${tab} after Next replaces history state and cached pages load`, async () => {
      const path = `/discover/${tab}`;
      const dom = new JSDOM('<div id="root"></div>', {
        url: `http://localhost${path}`,
      });
      const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
      const descriptors = globals.map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name)
      );
      Object.defineProperties(globalThis, {
        window: { configurable: true, value: dom.window },
        document: { configurable: true, value: dom.window.document },
        IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
      });
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      dom.window.requestAnimationFrame = (callback) => {
        frames.set(++frameId, callback);
        return frameId;
      };
      dom.window.cancelAnimationFrame = (id) => {
        frames.delete(id);
      };
      const scrolls: unknown[] = [];
      dom.window.scrollTo = (...args: unknown[]) => {
        scrolls.push(args);
      };
      const listeners = new Set<(url: string) => void>();
      const router = {
        asPath: path,
        isReady: true,
        events: {
          on: (_event: string, callback: (url: string) => void) =>
            listeners.add(callback),
          off: (_event: string, callback: (url: string) => void) =>
            listeners.delete(callback),
        },
      } as unknown as NextRouter;
      let itemCount = 80;
      let requests = 0;
      const fetchMore = () => {
        requests++;
      };
      const Probe = () => {
        useDiscoverScrollRestoration({
          mediaType,
          shuffleSeed: 'original-order',
          itemCount,
          isLoading: false,
          isReachingEnd: false,
          fetchMore,
        });
        return null;
      };
      const root = createRoot(dom.window.document.getElementById('root')!);
      const render = () =>
        act(async () => {
          root.render(
            createElement(
              RouterContext.Provider,
              { value: router },
              createElement(Probe)
            )
          );
        });
      const flushFrame = () =>
        act(async () => {
          const callbacks = [...frames.values()];
          frames.clear();
          callbacks.forEach((callback) => callback(0));
        });
      try {
        dom.window.history.replaceState({ key: 'list', __N: true }, '', path);
        await render();
        Object.defineProperty(dom.window, 'scrollY', { value: 4200 });
        listeners.forEach((listener) => listener(`/${mediaType}/123`));
        deepStrictEqual(readDiscoverScrollEntry(path), {
          path,
          scrollY: 4200,
          itemCount: 80,
          shuffleSeed: 'original-order',
        });
        await act(async () => root.render(null));
        strictEqual(listeners.size, 0);
        // Next's Back handler replaces the state before mounting the list.
        dom.window.history.replaceState({ key: 'list', __N: true }, '', path);
        itemCount = 20;
        await render();
        strictEqual(requests, 1);
        strictEqual(scrolls.length, 0);
        // SWR can serve subsequent pages from cache without a loading render.
        itemCount = 40;
        await render();
        strictEqual(requests, 2);
        itemCount = 80;
        await render();
        await flushFrame();
        strictEqual(scrolls.length, 0);
        await flushFrame();
        deepStrictEqual(scrolls, [[{ top: 4200, left: 0, behavior: 'auto' }]]);
        await render();
        strictEqual(frames.size, 0);
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
        globals.forEach((name, index) => {
          const descriptor = descriptors[index];
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else Reflect.deleteProperty(globalThis, name);
        });
      }
    });
  }
});
