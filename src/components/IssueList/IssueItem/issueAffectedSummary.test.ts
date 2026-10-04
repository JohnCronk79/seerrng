import assert from 'node:assert/strict';
import test from 'node:test';
import { getIssueAffectedSummary } from './issueAffectedSummary';

const baseIssue = {
  problemSeason: 0,
  problemEpisode: 0,
  problemEpisodes: [] as number[],
};

test('reports no affected seasons when the current selector is empty', () => {
  assert.equal(
    getIssueAffectedSummary(
      { ...baseIssue, problemEpisodeSelections: [] },
      [1, 2, 3]
    ),
    'None Selected'
  );
});

test('reports one affected season without reducing it to an episode', () => {
  assert.equal(
    getIssueAffectedSummary(
      {
        ...baseIssue,
        problemEpisodeSelections: [{ seasonNumber: 2, episodeNumbers: [1, 3] }],
      },
      [1, 2, 3]
    ),
    'Season 2'
  );
});

test('reports the number of affected seasons when several are selected', () => {
  assert.equal(
    getIssueAffectedSummary(
      {
        ...baseIssue,
        problemEpisodeSelections: [
          { seasonNumber: 1 },
          { seasonNumber: 3, episodeNumbers: [2] },
        ],
      },
      [1, 2, 3]
    ),
    '2 Seasons'
  );
});

test('reports all seasons when every available season is selected', () => {
  assert.equal(
    getIssueAffectedSummary(
      {
        ...baseIssue,
        problemEpisodeSelections: [
          { seasonNumber: 0 },
          { seasonNumber: 1 },
          { seasonNumber: 2 },
        ],
      },
      [0, 1, 2]
    ),
    'All Seasons'
  );
});

test('preserves legacy entire-series issues', () => {
  assert.equal(getIssueAffectedSummary(baseIssue, [1, 2, 3]), 'All Seasons');
  assert.equal(
    getIssueAffectedSummary(
      { ...baseIssue, problemEpisodeSelections: null },
      [1, 2, 3]
    ),
    'All Seasons'
  );
});
