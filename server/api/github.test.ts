import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  sanitizeGithubCommits,
  sanitizeGithubReleases,
} from '@server/api/github';

describe('GitHub update response normalization', () => {
  it('caps releases and exposes only bounded names', () => {
    const releases = sanitizeGithubReleases(
      [
        null,
        { name: {} },
        ...Array.from({ length: 150 }, (_, index) => ({
          name: `Release ${index}`,
          tag_name: `v3.0.${index}`,
          prerelease: false,
          draft: false,
          body: 'provider-only',
        })),
      ],
      500
    );

    assert.strictEqual(releases.length, 98);
    assert.deepStrictEqual(releases[0], {
      name: 'Release 0',
      tag_name: 'v3.0.0',
      prerelease: false,
      draft: false,
    });
  });

  it('caps commits and drops malformed nested commit data', () => {
    const commits = sanitizeGithubCommits(
      [
        null,
        { sha: 'bad', commit: null },
        ...Array.from({ length: 150 }, (_, index) => ({
          sha: `sha-${index}`,
          commit: { message: `Commit ${index}`, verification: 'provider-only' },
          parents: ['provider-only'],
        })),
      ],
      500
    );

    assert.strictEqual(commits.length, 98);
    assert.deepStrictEqual(commits[0], {
      sha: 'sha-0',
      commit: { message: 'Commit 0' },
    });
  });
});
