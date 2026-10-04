import { Notification } from '@server/lib/notifications';
import type { NotificationPayload } from '@server/lib/notifications/agents/agent';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import SlackAgent, {
  SLACK_FALLBACK_TEXT_LIMIT,
  SLACK_FIELD_TEXT_LIMIT,
  SLACK_HEADER_TEXT_LIMIT,
  SLACK_SECTION_TEXT_LIMIT,
  escapeSlackMrkdwnText,
} from './slack';

const createAgent = () =>
  new SlackAgent({
    enabled: true,
    embedPoster: false,
    types: Notification.ISSUE_COMMENT,
    options: {
      webhookUrl: 'https://hooks.slack.com/services/test',
      locale: 'en',
    },
  });

describe('Slack notification formatting', () => {
  it('escapes Slack control characters without splitting replacements', () => {
    assert.equal(
      escapeSlackMrkdwnText('A & B <!channel> <@U123>'),
      'A &amp; B &lt;!channel&gt; &lt;@U123&gt;'
    );
    assert.equal(escapeSlackMrkdwnText('&&', 6), '&amp;…');
  });

  it('prevents mention injection and respects Block Kit text limits', () => {
    const injection = '<!channel> <@U123> <https://evil.invalid|click>';
    const payload: NotificationPayload = {
      notifySystem: true,
      notifyAdmin: false,
      event: `${injection}${'&'.repeat(5_000)}`,
      subject: `${injection}${'S'.repeat(500)}`,
      message: `${injection}${'&'.repeat(5_000)}`,
      extra: [
        {
          name: `${injection}${'&'.repeat(5_000)}`,
          value: `${injection}${'&'.repeat(10_000)}`,
        },
      ],
    };

    const embed = createAgent().buildEmbed(
      Notification.TEST_NOTIFICATION,
      payload
    );
    const mrkdwnText = [
      embed.text,
      ...embed.blocks.flatMap((block) => [
        ...(block.text?.type === 'mrkdwn' ? [block.text.text] : []),
        ...(block.elements ?? []).flatMap((element) =>
          element.type === 'mrkdwn' ? [element.text] : []
        ),
        ...(block.fields ?? []).map((field) => field.text),
      ]),
    ].join('\n');
    assert.doesNotMatch(mrkdwnText, /<!channel>|<@U123>|<https:\/\//);
    assert.match(mrkdwnText, /&lt;!channel&gt;/);
    assert.ok(embed.text.length <= SLACK_FALLBACK_TEXT_LIMIT);

    for (const block of embed.blocks) {
      if (block.type === 'header') {
        assert.ok((block.text?.text.length ?? 0) <= SLACK_HEADER_TEXT_LIMIT);
      }
      if (block.text?.type === 'mrkdwn') {
        assert.ok(block.text.text.length <= SLACK_SECTION_TEXT_LIMIT);
        assert.equal(block.text.verbatim, true);
      }
      for (const field of block.fields ?? []) {
        assert.ok(field.text.length <= SLACK_FIELD_TEXT_LIMIT);
        assert.equal(field.verbatim, true);
      }
    }
  });
});
