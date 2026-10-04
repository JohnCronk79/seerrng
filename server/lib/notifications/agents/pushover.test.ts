import { Notification } from '@server/lib/notifications';
import { requiresDirectSafeHttpConnection } from '@server/utils/security';
import axios from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import PushoverAgent, {
  PUSHOVER_MESSAGE_LIMIT,
  PUSHOVER_TITLE_LIMIT,
  escapePushoverHtmlText,
} from './pushover';

const createAgent = () =>
  new PushoverAgent({
    enabled: true,
    embedPoster: false,
    types: Notification.TEST_NOTIFICATION,
    options: {
      accessToken: 'token',
      userToken: 'user',
      sound: '',
    },
  });

afterEach(() => mock.restoreAll());

describe('Pushover notification formatting', () => {
  it('escapes untrusted HTML text', () => {
    assert.equal(
      escapePushoverHtmlText(`<a href="x">Tom & Jerry's</a>`),
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
    );
  });

  it('bounds accepted issue text and disables HTML after plain fallback', async () => {
    const payload = await createAgent().buildPayload(
      Notification.TEST_NOTIFICATION,
      {
        notifySystem: true,
        notifyAdmin: false,
        event: 'E'.repeat(1_000),
        subject: '<b>forged</b>',
        message: `<a href="https://evil.invalid">${'M'.repeat(10_000)}</a>`,
        extra: [{ name: '<b>field</b>', value: '<i>value</i>' }],
      }
    );

    assert.ok((payload.title?.length ?? 0) <= PUSHOVER_TITLE_LIMIT);
    assert.ok((payload.message?.length ?? 0) <= PUSHOVER_MESSAGE_LIMIT);
    assert.equal(payload.html, 0);
  });

  it('keeps short formatted payloads while neutralizing injected tags', async () => {
    const payload = await createAgent().buildPayload(
      Notification.TEST_NOTIFICATION,
      {
        notifySystem: true,
        notifyAdmin: false,
        event: 'Test',
        subject: '<b>forged</b>',
        message: '<a href="https://evil.invalid">click</a>',
      }
    );

    assert.equal(payload.html, 1);
    assert.match(payload.message ?? '', /&lt;b&gt;forged&lt;\/b&gt;/);
    assert.match(payload.message ?? '', /&lt;a href=&quot;/);
    assert.doesNotMatch(payload.message ?? '', /<a href=/);
  });

  it('uses the supplied unsaved embed-poster setting', async () => {
    const get = mock.method(axios, 'get', async () => ({
      data: Buffer.from('image'),
      headers: { 'content-type': 'image/png' },
    }));
    const payload = await new PushoverAgent({
      enabled: true,
      embedPoster: true,
      types: Notification.TEST_NOTIFICATION,
      options: {
        accessToken: 'token',
        userToken: 'user',
        sound: '',
      },
    }).buildPayload(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'Test',
      image: 'https://1.1.1.1/poster.jpg',
    });

    assert.equal(payload.attachment_type, 'image/png');
    assert.equal(
      payload.attachment_base64,
      Buffer.from('image').toString('base64')
    );
    const requestOptions = get.mock.calls[0].arguments[1];
    assert.ok(requestOptions);
    assert.equal(requestOptions.proxy, false);
    assert.equal(requiresDirectSafeHttpConnection(requestOptions.lookup), true);
  });
});
