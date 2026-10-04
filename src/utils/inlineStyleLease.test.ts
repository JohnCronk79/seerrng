import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acquireInlineStyleLease } from './inlineStyleLease';

describe('acquireInlineStyleLease', () => {
  it('preserves the latest owner when leases release out of order', () => {
    const dom = new JSDOM('<body></body>');
    const body = dom.window.document.body;
    body.style.touchAction = 'pan-x';

    const releaseFirst = acquireInlineStyleLease(body, 'touchAction', 'none');
    const releaseSecond = acquireInlineStyleLease(
      body,
      'touchAction',
      'manipulation'
    );

    releaseFirst();
    assert.strictEqual(body.style.touchAction, 'manipulation');

    releaseSecond();
    assert.strictEqual(body.style.touchAction, 'pan-x');
    releaseSecond();
    assert.strictEqual(body.style.touchAction, 'pan-x');
    dom.window.close();
  });

  it('restores the previous owner when the latest lease releases first', () => {
    const dom = new JSDOM('<body style="overflow: auto"></body>');
    const body = dom.window.document.body;

    const releaseFirst = acquireInlineStyleLease(body, 'overflow', 'hidden');
    const releaseSecond = acquireInlineStyleLease(body, 'overflow', 'clip');

    releaseSecond();
    assert.strictEqual(body.style.overflow, 'hidden');
    releaseFirst();
    assert.strictEqual(body.style.overflow, 'auto');
    dom.window.close();
  });
});
