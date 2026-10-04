import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';

type IssueSelectionState = {
  problemSeason: number;
  problemEpisode: number;
  problemEpisodes?: number[];
  problemEpisodeSelections?: SeasonEpisodeSelection[] | null;
};

const getSeasonLabel = (seasonNumber: number): string =>
  seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;

export const getIssueAffectedSummary = (
  issue: IssueSelectionState,
  availableSeasonNumbers: number[]
): string => {
  const selectedSeasonNumbers = [
    ...new Set(
      (issue.problemEpisodeSelections ?? []).map(
        (selection) => selection.seasonNumber
      )
    ),
  ];

  if (selectedSeasonNumbers.length > 0) {
    const available = new Set(availableSeasonNumbers);
    const allSeasonsSelected =
      available.size > 0 &&
      available.size === selectedSeasonNumbers.length &&
      selectedSeasonNumbers.every((seasonNumber) =>
        available.has(seasonNumber)
      );

    if (allSeasonsSelected) {
      return 'All Seasons';
    }
    if (selectedSeasonNumbers.length === 1) {
      return getSeasonLabel(selectedSeasonNumbers[0]);
    }
    return `${selectedSeasonNumbers.length} Seasons`;
  }

  if (issue.problemSeason > 0 || issue.problemEpisodes?.length) {
    return getSeasonLabel(issue.problemSeason);
  }

  const legacyEntireSeriesIssue =
    issue.problemSeason === 0 &&
    issue.problemEpisode === 0 &&
    !issue.problemEpisodes?.length &&
    issue.problemEpisodeSelections == null;

  return legacyEntireSeriesIssue ? 'All Seasons' : 'None Selected';
};
