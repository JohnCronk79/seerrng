import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useLockBodyScroll } from './useLockBodyScroll';

describe('useLockBodyScroll', () => {
  it('restores the exact inline styles instead of copying computed CSS', async () => {
    const dom = new JSDOM(
      '<style>body { overflow: scroll; touch-action: pan-y; }</style><div id="first"></div><div id="second"></div>',
      { url: 'http://localhost/' }
    );
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window'
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document'
    );
    const originalActEnvironment = Object.getOwnPropertyDescriptor(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT'
    );
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

    const Probe = () => {
      useLockBodyScroll(true);
      return null;
    };
    const firstRoot = createRoot(document.getElementById('first')!);
    const secondRoot = createRoot(document.getElementById('second')!);
    const originalTouchAction = document.body.style.touchAction;

    try {
      assert.strictEqual(document.body.style.overflow, '');
      assert.strictEqual(document.body.style.touchAction, originalTouchAction);
      await act(async () => firstRoot.render(createElement(Probe)));
      assert.strictEqual(document.body.style.overflow, 'hidden');
      assert.strictEqual(document.body.style.touchAction, 'none');

      await act(async () => secondRoot.render(createElement(Probe)));
      await act(async () => firstRoot.unmount());
      assert.strictEqual(document.body.style.overflow, 'hidden');
      assert.strictEqual(document.body.style.touchAction, 'none');

      await act(async () => secondRoot.unmount());
      assert.strictEqual(document.body.style.overflow, '');
      assert.strictEqual(document.body.style.touchAction, originalTouchAction);
      assert.strictEqual(
        dom.window.getComputedStyle(document.body).overflow,
        'scroll'
      );
    } finally {
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
