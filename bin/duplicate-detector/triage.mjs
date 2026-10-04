const MAX_COMMENT_CANDIDATES = 3;
const MAX_REASON_LENGTH = 300;
const MAX_TITLE_LENGTH = 256;

export function normalizeSingleLineText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeInlineText(value, maxLength) {
  return normalizeSingleLineText(value, maxLength)
    .replace(/([\\`*_[\]<>])/gu, '\\$1')
    .replace(/@/gu, '@\u200b');
}

export function normalizeLlmVerdicts(verdicts, candidates) {
  if (!Array.isArray(verdicts)) {
    throw new Error('Invalid LLM response format - expected array');
  }

  const candidateNumbers = new Set(candidates.map(({ number }) => number));
  const normalized = new Map();
  for (const verdict of verdicts) {
    if (
      verdict === null ||
      typeof verdict !== 'object' ||
      !Number.isSafeInteger(verdict.number) ||
      !candidateNumbers.has(verdict.number) ||
      typeof verdict.duplicate !== 'boolean' ||
      (verdict.reason !== undefined && typeof verdict.reason !== 'string') ||
      normalized.has(verdict.number)
    ) {
      continue;
    }
    normalized.set(verdict.number, {
      duplicate: verdict.duplicate,
      reason: normalizeSingleLineText(verdict.reason, MAX_REASON_LENGTH),
    });
  }
  return normalized;
}

export function formatComment(candidates) {
  const lines = [
    '**Possible duplicate detected**',
    '',
    'This issue may be a duplicate of the following (detected via semantic similarity + LLM review):',
    '',
  ];

  for (const candidate of candidates.slice(0, MAX_COMMENT_CANDIDATES)) {
    if (!Number.isSafeInteger(candidate.number) || candidate.number < 1) {
      continue;
    }
    const title = sanitizeInlineText(candidate.title, MAX_TITLE_LENGTH);
    const confidence = Number.isFinite(candidate.score)
      ? ` (${(Math.min(1, Math.max(0, candidate.score)) * 100).toFixed(0)}% match)`
      : '';
    let line = `- #${candidate.number}${confidence} — ${title}`;
    if (candidate.llm_reason) {
      line += `\n  > *${sanitizeInlineText(candidate.llm_reason, MAX_REASON_LENGTH)}*`;
    }
    lines.push(line);
  }

  lines.push(
    '',
    'A maintainer will review this. If this is **not** a duplicate, no action is needed.',
    '',
    `<!-- duplicate-bot: candidates=${candidates
      .map(({ number }) => number)
      .filter((number) => Number.isSafeInteger(number) && number > 0)
      .slice(0, MAX_COMMENT_CANDIDATES)
      .join(',')} -->`
  );

  return lines.join('\n');
}
