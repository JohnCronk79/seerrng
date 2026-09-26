import { JSDOM } from 'jsdom';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  clearRequestStatusScrollEntry,
  isRequestDetailPath,
  readRequestStatusScrollEntry,
  saveRequestStatusScrollEntry,
} from './requestStatusScrollRestoration';

describe('request status scroll restoration', () => {
  let dom: JSDOM;
  let originalWindow: PropertyDescriptor | undefined;

  beforeEach(() => {
    dom = new JSDOM('', { url: 'http://localhost/requests?page=3' });
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    dom.window.history.replaceState(
      { key: 'request-status-page-3', __N: true },
      '',
      '/requests?page=3'
    );
  });

  afterEach(() => {
    dom.window.close();
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('recognizes every media detail route used by Requests', () => {
    for (const path of [
      '/movie/1',
      '/tv/2',
      '/music/artist-id',
      '/book/OL1W',
    ]) {
      strictEqual(isRequestDetailPath(path), true);
    }
    strictEqual(isRequestDetailPath('/requests'), false);
    strictEqual(isRequestDetailPath('/discover/movies'), false);
  });

  it('saves and restores an exact filtered or paged Requests path', () => {
    saveRequestStatusScrollEntry({
      path: '/requests?page=3',
      scrollY: 2840,
    });

    deepStrictEqual(readRequestStatusScrollEntry('/requests?page=3'), {
      path: '/requests?page=3',
      scrollY: 2840,
    });
    strictEqual(
      readRequestStatusScrollEntry('/requests?page=2'),
      undefined
    );

    clearRequestStatusScrollEntry();
    strictEqual(
      readRequestStatusScrollEntry('/requests?page=3'),
      undefined
    );
  });
});
