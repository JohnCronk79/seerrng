import assert from 'node:assert/strict';
import test from 'node:test';
import { redactLogInfo, redactLogString } from './logger';

test('logger redacts structured secrets without dropping Winston symbols', () => {
  const levelSymbol = Symbol.for('level');
  const info = {
    level: 'info',
    message: 'Request failed',
    label: 'Test',
    auth: 'subscription-secret',
    nested: { apiKey: 'service-secret', bypassFilter: 'localhost' },
    [levelSymbol]: 'info',
  };

  const result = redactLogInfo(info);

  assert.strictEqual(result, info);
  assert.strictEqual(result.message, 'Request failed');
  assert.strictEqual(result[levelSymbol], 'info');
  assert.strictEqual(result.auth, '[REDACTED]');
  assert.deepEqual(result.nested, {
    apiKey: '[REDACTED]',
    bypassFilter: 'localhost',
  });
});

test('logger redacts secrets embedded in messages and metadata strings', () => {
  const message =
    'Failed https://admin:password@example.test/path?api_key=query-secret ' +
    'Authorization: Bearer bearer-secret';
  const info = {
    level: 'error',
    message,
    errorMessage:
      'password=db-secret Cookie: session-cookie ' +
      'https://hooks.slack.com/services/T000/B000/slack-secret',
    nested: [
      'https://discord.com/api/webhooks/123456/discord-secret',
      'https://api.telegram.org/bottelegram-secret/sendMessage',
    ],
  };

  const result = redactLogInfo(info);
  const serialized = JSON.stringify(result);

  for (const secret of [
    'password@example',
    'query-secret',
    'bearer-secret',
    'db-secret',
    'session-cookie',
    'slack-secret',
    'discord-secret',
    'telegram-secret',
  ]) {
    assert.strictEqual(serialized.includes(secret), false);
  }
  assert.match(String(result.message), /api_key=\[REDACTED\]/);
  assert.match(String(result.message), /Bearer \[REDACTED\]/i);
});

test('redactLogString leaves ordinary diagnostic values intact', () => {
  assert.strictEqual(
    redactLogString('Request failed with status=500 at https://example.test'),
    'Request failed with status=500 at https://example.test'
  );
});

test('redactLogString bounds messages and escapes log control characters', () => {
  const result = redactLogString(
    `first\nsecond\r\u001b[31m\u2028${'x'.repeat(20_000)}\ud83d\ude00`
  );

  assert.strictEqual(result.includes('\n'), false);
  assert.strictEqual(result.includes('\r'), false);
  assert.strictEqual(result.includes('\u001b'), false);
  assert.strictEqual(result.includes('\u2028'), false);
  assert.match(result, /\\u000a/);
  assert.match(result, /\\u000d/);
  assert.match(result, /\\u001b/);
  assert.match(result, /\\u2028/);
  assert.ok(result.endsWith('[TRUNCATED]'));
  assert.ok(result.length < 17_000);
});
