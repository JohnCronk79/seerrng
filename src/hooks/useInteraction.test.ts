import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useInteraction from './useInteraction';

describe('useInteraction', () => {
  it('coalesces mouse transition timers and clears the pending timer', async () => {
    const dom = new JSDOM('<div id="root"></div>', {
      url: 'http://localhost/',
    });
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window'
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document'
    );
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalDateNow = Date.now;
    const originalActEnvironment = Object.getOwnPropertyDescriptor(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT'
    );
    let now = 0;
    let scheduled = 0;
    const cleared: number[] = [];

    Object.defineProperty(dom.window, 'ontouchstart', {
      configurable: true,
      value: null,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    });
    Date.now = () => now;
    globalThis.setTimeout = (() => {
      scheduled += 1;
      return scheduled;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: number) => {
      cleared.push(timer);
    }) as unknown as typeof clearTimeout;

    const Probe = () => {
      useInteraction();
      return null;
    };
    const root = createRoot(dom.window.document.getElementById('root')!);

    try {
      await act(async () => root.render(createElement(Probe)));
      now = 2_000;
      for (let index = 0; index < 100; index += 1) {
        dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove'));
      }

      assert.equal(scheduled, 1);
      await act(async () => root.unmount());
      assert.deepEqual(cleared, [1]);
    } finally {
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
      if (originalActEnvironment) {
        Object.defineProperty(
          globalThis,
          'IS_REACT_ACT_ENVIRONMENT',
          originalActEnvironment
        );
      } else {
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      }
      dom.window.close();
    }
  });
});
