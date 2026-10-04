#!/usr/bin/env node
/**
 * Duplicate Issue Detector
 *
 * Triggered on new issue creation. Compares the new issue against an
 * existing embedding index, then uses an LLM to
 * confirm duplicates before posting a comment for maintainer review.
 */

import { pipeline } from '@huggingface/transformers';
import { existsSync } from 'node:fs';
import { loadIndex } from './index.mjs';
import {
  formatComment,
  normalizeLlmVerdicts,
  normalizeSingleLineText,
} from './triage.mjs';
import {
  addLabel,
  dotProduct,
  fetchIssues,
  getIssue,
  issueText,
  postComment,
} from './utils.mjs';

const SIMILARITY_THRESHOLD = 0.55;
const TOP_K = 5;
const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const INDEX_PATH = process.env.INDEX_PATH || 'issue_index.json';
const LABEL_NAME = 'possible-duplicate';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const ISSUE_NUMBER = parseInt(process.env.ISSUE_NUMBER, 10);

function findSimilar(
  queryEmbedding,
  index,
  { topK = TOP_K, threshold = SIMILARITY_THRESHOLD, excludeNumber } = {}
) {
  const { issues, embeddings } = index;
  if (!issues.length) return [];

  const scored = issues.map((issue, i) => ({
    ...issue,
    score: dotProduct(queryEmbedding, embeddings[i]),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .filter(
      (c) =>
        c.score >= threshold && (!excludeNumber || c.number !== excludeNumber)
    )
    .slice(0, topK);
}

const CONFIRM_SYSTEM_PROMPT = `You are a GitHub issue triage assistant. You will be given a NEW issue and one \
or more CANDIDATE issues that may be duplicates.

For each candidate, determine if the new issue is truly a duplicate (same root \
problem/request) or merely related (similar area but different issue).

Respond ONLY with a JSON array of objects, each with:
- "number": the candidate issue number
- "duplicate": true or false
- "reason": one-sentence explanation

Example:
[{"number": 123, "duplicate": true, "reason": "Both report the same crash when ..."}]`;

async function confirmWithLlm(newIssue, candidates) {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY not set — skipping LLM confirmation');
    return candidates;
  }

  const candidateText = candidates
    .map(
      (c) =>
        `### Candidate #${c.number}\n` +
        `**Title:** ${c.title}\n` +
        `**State:** ${c.state}\n` +
        `**Body preview:** ${(c.body_preview || 'N/A').slice(0, 500)}`
    )
    .join('\n\n');

  const userPrompt =
    `## NEW ISSUE #${newIssue.number}\n` +
    `**Title:** ${newIssue.title}\n` +
    `**Body:**\n${(newIssue.body || 'No body').slice(0, 1500)}\n\n` +
    `---\n\n` +
    `## CANDIDATES\n${candidateText}`;

  try {
    const resp = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: CONFIRM_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!resp.ok) {
      throw new Error(`Groq API error ${resp.status}`);
    }

    let content = (await resp.json()).choices[0].message.content.trim();

    if (content.startsWith('```')) {
      content = content
        .split('\n')
        .slice(1)
        .join('\n')
        .replace(/```\s*$/, '')
        .trim();
    }

    const verdicts = JSON.parse(content);
    const verdictMap = normalizeLlmVerdicts(verdicts, candidates);

    const confirmed = [];
    for (const c of candidates) {
      const verdict = verdictMap.get(c.number);
      if (verdict?.duplicate === true) {
        confirmed.push({ ...c, llm_reason: verdict.reason });
      } else {
        const reason = verdict?.reason || 'not evaluated';
        console.log(
          `  #${c.number} ruled out by LLM: ${normalizeSingleLineText(reason, 300)}`
        );
      }
    }

    return confirmed;
  } catch (err) {
    console.warn(
      `LLM confirmation failed: ${normalizeSingleLineText(err.message, 300)} - skipping automated duplicate action`
    );
    return [];
  }
}

async function main() {
  if (!ISSUE_NUMBER) {
    console.error('ISSUE_NUMBER not set');
    process.exit(1);
  }

  console.log(`Processing issue #${ISSUE_NUMBER}`);
  const issue = await getIssue(ISSUE_NUMBER);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentIssues = await fetchIssues({
    creator: issue.user.login,
    state: 'all',
    maxIssues: 11,
    maxPages: 10,
    sort: 'created',
  });
  const recentIssueCount = recentIssues.filter(
    (recentIssue) =>
      typeof recentIssue.created_at === 'string' &&
      recentIssue.created_at >= oneHourAgo
  ).length;

  if (recentIssueCount > 10) {
    console.log(
      `User ${issue.user.login} created more than 10 issues in the last hour - skipping to prevent spam`
    );
    return;
  }

  if (issue.pull_request) {
    console.log('Skipping - this is a pull request');
    return;
  }

  if (issue.user.type === 'Bot') {
    console.log('Skipping - issue created by bot');
    return;
  }

  if (!existsSync(INDEX_PATH)) {
    throw new Error(`Index file not found at ${INDEX_PATH}`);
  }
  const index = loadIndex(INDEX_PATH);
  console.log(`Loaded index with ${index.issues.length} issues`);
  const liveIssues = await fetchIssues({
    state: 'all',
    maxIssues: 5000,
    maxPages: 100,
    sort: 'updated',
  });
  const liveIssuesByNumber = new Map(
    liveIssues
      .filter((candidate) => Number.isSafeInteger(candidate.number))
      .map((candidate) => [candidate.number, candidate])
  );
  console.log(`Loading model: ${MODEL_NAME}`);
  const extractor = await pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'fp32',
  });

  const text = issueText(issue.title, issue.body);
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const queryEmbedding = output.tolist()[0];

  let candidates = findSimilar(queryEmbedding, index, {
    topK: TOP_K,
    threshold: SIMILARITY_THRESHOLD,
    excludeNumber: issue.number,
  });

  if (!candidates.length) {
    console.log('No similar issues found above threshold - done');
    return;
  }

  const liveCandidates = candidates
    .map((candidate) => liveIssuesByNumber.get(candidate.number))
    .filter((candidate) => candidate !== undefined)
    .map((candidate) => ({
      number: candidate.number,
      title: candidate.title,
      state: candidate.state,
      body_preview:
        typeof candidate.body === 'string'
          ? candidate.body.slice(0, 500)
          : 'N/A',
    }));

  if (!liveCandidates.length) {
    console.log('No live metadata found for similar issues - done');
    return;
  }

  console.log(`Found ${candidates.length} candidates above threshold:`);
  for (const c of candidates) {
    console.log(
      `  #${c.number} (${c.score.toFixed(3)}) - ${normalizeSingleLineText(c.title, 256)}`
    );
  }

  console.log('Running LLM confirmation via Groq...');
  candidates = await confirmWithLlm(issue, liveCandidates);

  if (!candidates.length) {
    console.log('LLM ruled out all candidates - done');
    return;
  }

  const comment = formatComment(candidates);
  await postComment(ISSUE_NUMBER, comment);
  await addLabel(ISSUE_NUMBER, LABEL_NAME);

  console.log('Done!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
