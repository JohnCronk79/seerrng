import { Notification } from '@server/lib/notifications';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import NtfyAgent, {
  NTFY_MESSAGE_BYTE_LIMIT,
  NTFY_TITLE_BYTE_LIMIT,
  escapeNtfyMarkdownText,
} from './ntfy';

const createAgent = () =>
  new NtfyAgent({
    enabled: true,
    embedPoster: false,
    types: Notification.TEST_NOTIFICATION,
    options: {
      url: 'https://ntfy.sh',
      topic: 'test',
      priority: 3,
      locale: 'en',
      authMethodUsernamePassword: false,
      authMethodToken: false,
    },
  });

describe('ntfy notification formatting', () => {
  it('escapes untrusted Markdown', () => {
    assert.equal(
      escapeNtfyMarkdownText('[click](https://evil.invalid) <tag>'),
      '\\[click\\]\\(https://evil\\.invalid\\) \\<tag\\>'
    );
  });

  it('keeps JSON messages within the default ntfy byte limit', () => {
    const payload = createAgent().buildPayload(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      event: '😀'.repeat(500),
      subject: 'subject',
      message: '[click](https://evil.invalid) '.repeat(1_000),
      extra: [{ name: '<field>', value: '😀'.repeat(5_000) }],
    });

    assert.ok(
      Buffer.byteLength(payload.title as string) <= NTFY_TITLE_BYTE_LIMIT
    );
    assert.ok(
      Buffer.byteLength(payload.message as string) <= NTFY_MESSAGE_BYTE_LIMIT
    );
    assert.equal(payload.markdown, false);
  });

  it('retains Markdown mode only after neutralizing input syntax', () => {
    const payload = createAgent().buildPayload(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'subject',
      message: '<!channel> [click](https://evil.invalid)',
    });

    assert.equal(payload.markdown, true);
    assert.equal(
      payload.message,
      '\\<\\!channel\\> \\[click\\]\\(https://evil\\.invalid\\)'
    );
  });
});
