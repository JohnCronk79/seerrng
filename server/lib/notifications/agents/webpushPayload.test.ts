import { Notification } from '@server/lib/notifications';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import WebPushAgent from './webpush';

describe('WebPush notification payload settings', () => {
  it('uses the supplied unsaved embed-poster setting', () => {
    const payload = {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'Test',
      message: 'Message',
      image: 'https://example.com/poster.jpg',
    };
    const withoutPoster = new WebPushAgent({
      enabled: true,
      embedPoster: false,
      options: {},
    }).buildPayload(Notification.TEST_NOTIFICATION, payload);
    const withPoster = new WebPushAgent({
      enabled: true,
      embedPoster: true,
      options: {},
    }).buildPayload(Notification.TEST_NOTIFICATION, payload);

    assert.equal(withoutPoster.image, undefined);
    assert.equal(withPoster.image, payload.image);
  });
});
