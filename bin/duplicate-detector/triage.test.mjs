import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatComment,
  normalizeLlmVerdicts,
  normalizeSingleLineText,
  sanitizeInlineText,
} from './triage.mjs';
import { fetchIssues, issueText } from './utils.mjs';

test('fetchIssues applies the per-creator spam boundary', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => [
        { number: 1, title: 'Issue', body: '', user: { login: 'alice' } },
      ],
    };
  };

  const issues = await fetchIssues({
    creator: 'alice',
    maxIssues: 1,
    sort: 'created',
  });
  assert.equal(issues.length, 1);
  assert.equal(requestedUrl.searchParams.get('creator'), 'alice');
  assert.equal(requestedUrl.searchParams.get('sort'), 'created');
});

test('fetchIssues rejects malformed creator names', async () => {
  await assert.rejects(
    fetchIssues({ creator: 'alice\nstate=closed', maxIssues: 1 }),
    /Invalid GitHub issue creator/u
  );
  await assert.rejects(
    fetchIssues({ maxIssues: 1, maxPages: 101 }),
    /Invalid GitHub issue page limit/u
  );
});

test('normalizeLlmVerdicts requires typed candidate-scoped verdicts', () => {
  const candidates = [{ number: 7 }, { number: 8 }];
  const verdicts = normalizeLlmVerdicts(
    [
      { number: 7, duplicate: 'false', reason: 'wrong type' },
      { number: 999, duplicate: true, reason: 'unknown candidate' },
      { number: 8, duplicate: true, reason: 'same\n::warning::issue' },
    ],
    candidates
  );

  assert.equal(verdicts.size, 1);
  assert.deepEqual(verdicts.get(8), {
    duplicate: true,
    reason: 'same ::warning::issue',
  });
});

test('formatComment neutralizes mentions and Markdown injection', () => {
  const comment = formatComment([
    {
      number: 42,
      score: 5,
      title: '@maintainers <details> [click](https://example.invalid)',
      llm_reason: '@everyone\n```\nmalicious',
    },
  ]);

  assert.doesNotMatch(comment, /@maintainers|@everyone/u);
  assert.doesNotMatch(comment, /<details>|\n```/u);
  assert.match(comment, /100% match/u);
  assert.match(comment, /candidates=42/u);
});

test('issueText bounds provider-controlled title and body values', () => {
  const text = issueText('t'.repeat(300), 'b'.repeat(3000));
  const [title, body] = text.split('\n\n');
  assert.equal(title.length, 256);
  assert.equal(body.length, 2003);
  assert.equal(issueText(null, { unexpected: true }), '');
  assert.equal(normalizeSingleLineText('a\n::error::b', 30), 'a ::error::b');
  assert.equal(sanitizeInlineText('@a\n<b>', 20), '@\u200ba \\<b\\>');
});
