import { Notification } from '@server/lib/notifications';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import DiscordAgent, {
  DISCORD_EMBED_DESCRIPTION_LIMIT,
  DISCORD_EMBED_FIELD_COUNT_LIMIT,
  DISCORD_EMBED_FIELD_NAME_LIMIT,
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  DISCORD_EMBED_TITLE_LIMIT,
  DISCORD_EMBED_TOTAL_TEXT_LIMIT,
} from './discord';

describe('Discord notification formatting', () => {
  it('respects per-field and aggregate embed limits', () => {
    const agent = new DiscordAgent({
      enabled: true,
      embedPoster: true,
      types: Notification.TEST_NOTIFICATION,
      options: {
        webhookUrl: 'https://discord.com/api/webhooks/test',
        enableMentions: false,
        locale: 'en',
        useUserLocale: false,
      },
    });
    const embed = agent.buildEmbed(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      event: 'E'.repeat(1_000),
      subject: 'S'.repeat(1_000),
      message: 'M'.repeat(10_000),
      image: 'https://example.com/poster.jpg',
      extra: Array.from({ length: 30 }, (_, index) => ({
        name: `${index}${'N'.repeat(1_000)}`,
        value: 'V'.repeat(10_000),
      })),
    });

    assert.ok((embed.title?.length ?? 0) <= DISCORD_EMBED_TITLE_LIMIT);
    assert.ok(
      (embed.description?.length ?? 0) <= DISCORD_EMBED_DESCRIPTION_LIMIT
    );
    assert.ok((embed.fields?.length ?? 0) <= DISCORD_EMBED_FIELD_COUNT_LIMIT);
    for (const field of embed.fields ?? []) {
      assert.ok(field.name.length <= DISCORD_EMBED_FIELD_NAME_LIMIT);
      assert.ok(field.value.length <= DISCORD_EMBED_FIELD_VALUE_LIMIT);
    }
    const totalLength =
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      (embed.fields ?? []).reduce(
        (total, field) => total + field.name.length + field.value.length,
        0
      );
    assert.ok(totalLength <= DISCORD_EMBED_TOTAL_TEXT_LIMIT);
    assert.equal(embed.thumbnail?.url, 'https://example.com/poster.jpg');
  });
});
