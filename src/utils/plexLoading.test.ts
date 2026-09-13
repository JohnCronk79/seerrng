import PlexLoading from '@app/pages/login/plex/loading';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window'
);
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'document'
);
const originalActEnvironmentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'IS_REACT_ACT_ENVIRONMENT'
);

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
  if (originalActEnvironmentDescriptor) {
    Object.defineProperty(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT',
      originalActEnvironmentDescriptor
    );
  } else {
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

describe('Plex loading popup', () => {
  it('closes only after Plex returns with the completion marker', async () => {
    const dom = new JSDOM('<div id="root"></div>', {
      url: 'https://seerr.example/login/plex/loading?complete=1',
    });
    const nativeClose = dom.window.close.bind(dom.window);
    let closeCalls = 0;
    Object.defineProperty(dom.window, 'close', {
      configurable: true,
      value: () => {
        closeCalls += 1;
      },
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

    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => root.render(createElement(PlexLoading)));
      assert.equal(closeCalls, 1);
    } finally {
      await act(async () => root.unmount());
      nativeClose();
    }
  });

  it('leaves the initial loading page open without the completion marker', async () => {
    const dom = new JSDOM(' <div id="root"></div>', {
      url: 'https://seerr.example/login/plex/loading',
    });
    const nativeClose = dom.window.close.bind(dom.window);
    let closeCalls = 0;
    Object.defineProperty(dom.window, 'close', {
      configurable: true,
      value: () => {
        closeCalls += 1;
      },
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

    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => root.render(createElement(PlexLoading)));
      assert.equal(closeCalls, 0);
    } finally {
      await act(async () => root.unmount());
      nativeClose();
    }
  });
});
