import { Notification } from '@server/lib/notifications';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import TelegramAgent, {
  TELEGRAM_MESSAGE_TEXT_LIMIT,
  TELEGRAM_PHOTO_CAPTION_LIMIT,
  escapeTelegramMarkdownText,
} from './telegram';

const createAgent = (embedPoster: boolean) =>
  new TelegramAgent({
    enabled: true,
    embedPoster,
    types: Notification.TEST_NOTIFICATION,
    options: {
      botAPI: 'token',
      chatId: '1',
      messageThreadId: '',
      sendSilently: false,
    },
  });

describe('Telegram notification formatting', () => {
  it('escapes MarkdownV2 tokens atomically', () => {
    assert.equal(escapeTelegramMarkdownText('a_b[c].'), 'a\\_b\\[c\\]\\.');
    assert.equal(escapeTelegramMarkdownText('___', 4), '\\_…');
  });

  it('bounds text messages and photo captions using the supplied settings', () => {
    const payload = {
      notifySystem: true,
      notifyAdmin: false,
      subject: `${'S'.repeat(500)}_`,
      message: `${'M_'.repeat(10_000)}`,
      image: 'https://example.com/poster.jpg',
      extra: [{ name: '*field*', value: 'V_'.repeat(10_000) }],
    };

    const textPayload = createAgent(false).buildPayload(
      Notification.TEST_NOTIFICATION,
      payload
    );
    assert.ok('text' in textPayload);
    assert.ok((textPayload.text?.length ?? 0) <= TELEGRAM_MESSAGE_TEXT_LIMIT);
    assert.doesNotMatch(textPayload.text ?? '', /\\$/);

    const photoPayload = createAgent(true).buildPayload(
      Notification.TEST_NOTIFICATION,
      payload
    );
    assert.ok('caption' in photoPayload);
    assert.ok(
      (photoPayload.caption?.length ?? 0) <= TELEGRAM_PHOTO_CAPTION_LIMIT
    );
    assert.equal(photoPayload.photo, payload.image);
    assert.doesNotMatch(photoPayload.caption ?? '', /\\$/);
  });
});
