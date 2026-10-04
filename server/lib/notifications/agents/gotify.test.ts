import { Notification } from '@server/lib/notifications';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import GotifyAgent, { escapeGotifyMarkdownText } from './gotify';

describe('Gotify notification formatting', () => {
  it('neutralizes untrusted Markdown and HTML syntax', () => {
    assert.equal(
      escapeGotifyMarkdownText('[click](https://evil.invalid) <tag>'),
      '\\[click\\]\\(https://evil\\.invalid\\) \\<tag\\>'
    );

    const payload = new GotifyAgent({
      enabled: true,
      embedPoster: false,
      types: Notification.TEST_NOTIFICATION,
      options: {
        url: 'https://gotify.example.com',
        token: 'token',
        priority: 1,
        locale: 'en',
      },
    }).buildPayload(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'subject',
      message: '<!channel> [click](https://evil.invalid)',
      extra: [{ name: '<tag>', value: '*bold*' }],
    });

    assert.match(payload.message, /\\<\\!channel\\>/);
    assert.match(payload.message, /\\\[click\\\]\\\(https:/);
    assert.match(payload.message, /\\<tag\\>/);
    assert.match(payload.message, /\\\*bold\\\*/);
  });
});
