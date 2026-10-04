const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

function ghHeaders() {
  return {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
  };
}

export async function fetchIssues({
  state = 'open',
  since,
  maxIssues = 5000,
  creator,
  sort = 'updated',
  maxPages = 100,
} = {}) {
  if (!Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > 5000) {
    throw new Error('Invalid GitHub issue fetch limit');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error('Invalid GitHub issue page limit');
  }
  const issues = [];
  let page = 1;
  if (!['created', 'updated', 'comments'].includes(sort)) {
    throw new Error('Invalid GitHub issue sort');
  }

  while (issues.length < maxIssues && page <= maxPages) {
    const perPage = 100;
    const params = new URLSearchParams({
      state,
      per_page: String(perPage),
      page: String(page),
      sort,
      direction: 'desc',
    });
    if (since) params.set('since', since);
    if (creator !== undefined) {
      if (
        typeof creator !== 'string' ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(creator)
      ) {
        throw new Error('Invalid GitHub issue creator');
      }
      params.set('creator', creator);
    }

    const url = `${GITHUB_API}/repos/${GITHUB_REPOSITORY}/issues?${params}`;
    const resp = await fetch(url, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
    }

    const batch = await resp.json();
    if (!Array.isArray(batch)) {
      throw new Error('GitHub issue list response must be an array');
    }
    if (!batch.length) break;

    for (const item of batch) {
      if (!item.pull_request) {
        issues.push(item);
      }
    }

    page++;
    if (batch.length < perPage) break;
  }

  return issues.slice(0, maxIssues);
}

export async function getIssue(issueNumber) {
  const url = `${GITHUB_API}/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}`;
  const resp = await fetch(url, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

export async function postComment(issueNumber, body) {
  const url = `${GITHUB_API}/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}/comments`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(
      `Failed to post comment: ${resp.status} ${resp.statusText}`
    );
  }

  console.log(`Posted comment on #${issueNumber}`);
}

export async function addLabel(issueNumber, label) {
  const url = `${GITHUB_API}/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}/labels`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [label] }),
    signal: AbortSignal.timeout(30_000),
  });

  if (resp.status === 404) {
    console.warn(
      `Label '${label}' does not exist - skipping. Create it manually.`
    );
    return;
  }

  if (!resp.ok) {
    throw new Error(`Failed to add label: ${resp.status} ${resp.statusText}`);
  }

  console.log(`Added label '${label}' to #${issueNumber}`);
}

export function issueText(title, body) {
  const boundedTitle =
    typeof title === 'string' ? title.trim().slice(0, 256) : '';
  let boundedBody = typeof body === 'string' ? body.trim() : '';
  if (boundedBody.length > 2000) {
    boundedBody = `${boundedBody.slice(0, 2000)}...`;
  }
  return boundedBody ? `${boundedTitle}\n\n${boundedBody}` : boundedTitle;
}

export function dotProduct(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Number.NEGATIVE_INFINITY;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      return Number.NEGATIVE_INFINITY;
    }
    sum += a[i] * b[i];
  }
  return sum;
}
