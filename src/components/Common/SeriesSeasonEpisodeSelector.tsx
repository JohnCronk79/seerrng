import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { CheckIcon } from '@heroicons/react/24/solid';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import useSWR from 'swr';

interface SeriesSeasonEpisodeSelectorProps {
  tvId: number;
  seasons: TvDetails['seasons'];
  selections: SeasonEpisodeSelection[];
  activeSeason: number;
  onActiveSeasonChange: (seasonNumber: number) => void;
  onSelectionsChange: (selections: SeasonEpisodeSelection[]) => void;
  disabledSeasons?: number[];
  disabledEpisodes?: Record<number, number[]>;
}

const SelectCircle = ({
  selected,
  disabled = false,
  label,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-label={label}
    aria-pressed={selected}
    className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 ${
      selected
        ? 'border-emerald-400 bg-emerald-500 text-white'
        : 'border-gray-600 bg-gray-800 text-transparent'
    }`}
  >
    <CheckIcon className="h-3 w-3" aria-hidden="true" />
  </button>
);

const normalizeSelections = (selections: SeasonEpisodeSelection[]) =>
  [...selections]
    .map((selection) => ({
      seasonNumber: selection.seasonNumber,
      ...(selection.episodeNumbers
        ? {
            episodeNumbers: [...new Set(selection.episodeNumbers)].sort(
              (a, b) => a - b
            ),
          }
        : {}),
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

const SeriesSeasonEpisodeSelector = ({
  tvId,
  seasons,
  selections,
  activeSeason,
  onActiveSeasonChange,
  onSelectionsChange,
  disabledSeasons = [],
  disabledEpisodes = {},
}: SeriesSeasonEpisodeSelectorProps) => {
  const { data, error } = useSWR<SeasonWithEpisodes>(
    activeSeason >= 0 ? `/api/v1/tv/${tvId}/season/${activeSeason}` : null
  );
  const activeSelection = selections.find(
    (selection) => selection.seasonNumber === activeSeason
  );
  const blockedEpisodes = disabledEpisodes[activeSeason] ?? [];
  const episodeNumbers =
    data?.episodes
      .map((episode) => episode.episodeNumber)
      .filter((episodeNumber) => !blockedEpisodes.includes(episodeNumber)) ??
    [];
  const allEpisodesSelected =
    !!activeSelection &&
    (activeSelection.episodeNumbers === undefined ||
      (episodeNumbers.length > 0 &&
        episodeNumbers.every((episodeNumber) =>
          activeSelection.episodeNumbers?.includes(episodeNumber)
        )));
  const selectableSeasons = seasons.filter(
    (season) => !disabledSeasons.includes(season.seasonNumber)
  );
  const allSeasonsSelected =
    selectableSeasons.length > 0 &&
    selectableSeasons.every((season) =>
      selections.some(
        (selection) => selection.seasonNumber === season.seasonNumber
      )
    );

  const replaceSelection = (
    seasonNumber: number,
    episodeNumbersForSeason?: number[]
  ) => {
    const remaining = selections.filter(
      (selection) => selection.seasonNumber !== seasonNumber
    );
    onSelectionsChange(
      normalizeSelections([
        ...remaining,
        {
          seasonNumber,
          ...(episodeNumbersForSeason
            ? { episodeNumbers: episodeNumbersForSeason }
            : {}),
        },
      ])
    );
  };

  const toggleSeason = (seasonNumber: number) => {
    onActiveSeasonChange(seasonNumber);
    if (
      selections.some((selection) => selection.seasonNumber === seasonNumber)
    ) {
      onSelectionsChange(
        selections.filter(
          (selection) => selection.seasonNumber !== seasonNumber
        )
      );
    } else {
      replaceSelection(seasonNumber);
    }
  };

  const toggleAllSeasons = () => {
    if (allSeasonsSelected) {
      onSelectionsChange(
        selections.filter((selection) =>
          disabledSeasons.includes(selection.seasonNumber)
        )
      );
      return;
    }

    const disabledSelections = selections.filter((selection) =>
      disabledSeasons.includes(selection.seasonNumber)
    );
    onSelectionsChange(
      normalizeSelections([
        ...disabledSelections,
        ...selectableSeasons.map((season) => ({
          seasonNumber: season.seasonNumber,
        })),
      ])
    );
    if (activeSeason < 0 && selectableSeasons[0]) {
      onActiveSeasonChange(selectableSeasons[0].seasonNumber);
    }
  };

  const toggleEpisode = (episodeNumber: number) => {
    if (blockedEpisodes.includes(episodeNumber)) {
      return;
    }

    if (!activeSelection) {
      replaceSelection(activeSeason, [episodeNumber]);
      return;
    }

    const currentEpisodes = activeSelection.episodeNumbers ?? [
      ...episodeNumbers,
    ];
    const nextEpisodes = currentEpisodes.includes(episodeNumber)
      ? currentEpisodes.filter((number) => number !== episodeNumber)
      : [...currentEpisodes, episodeNumber].sort((a, b) => a - b);

    if (nextEpisodes.length === 0) {
      onSelectionsChange(
        selections.filter(
          (selection) => selection.seasonNumber !== activeSeason
        )
      );
    } else if (
      episodeNumbers.length > 0 &&
      episodeNumbers.every((number) => nextEpisodes.includes(number))
    ) {
      replaceSelection(activeSeason);
    } else {
      replaceSelection(activeSeason, nextEpisodes);
    }
  };

  const toggleAllEpisodes = () => {
    if (allEpisodesSelected) {
      onSelectionsChange(
        selections.filter(
          (selection) => selection.seasonNumber !== activeSeason
        )
      );
    } else {
      replaceSelection(activeSeason);
    }
  };

  return (
    <div className="mt-[5px] grid min-w-0 gap-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
      <section className="refreshed-inset-surface min-w-[12rem] rounded-lg border border-gray-700 p-2">
        <div className="grid grid-cols-[1.25rem_minmax(5.5rem,1fr)_4rem] items-center gap-x-2 border-b border-gray-600 px-1 pb-2 text-xs font-semibold text-gray-200">
          <SelectCircle
            selected={allSeasonsSelected}
            label={
              allSeasonsSelected ? 'Clear all seasons' : 'Select all seasons'
            }
            onClick={toggleAllSeasons}
          />
          <span>Season</span>
          <span className="text-center">Episodes</span>
        </div>
        <div className="max-h-[214px] space-y-0.5 overflow-y-auto pr-1 pt-1">
          {seasons.map((season) => {
            const selected = selections.some(
              (selection) => selection.seasonNumber === season.seasonNumber
            );
            const disabled = disabledSeasons.includes(season.seasonNumber);
            return (
              <div
                key={season.seasonNumber}
                className={`grid w-full grid-cols-[1.25rem_minmax(5.5rem,1fr)_4rem] items-center gap-x-2 rounded px-1 py-1 hover:bg-indigo-500/15 ${
                  activeSeason === season.seasonNumber ? 'bg-indigo-500/10' : ''
                }`}
              >
                <SelectCircle
                  selected={selected || disabled}
                  disabled={disabled}
                  label={`${selected ? 'Clear' : 'Select'} ${season.name}`}
                  onClick={() => toggleSeason(season.seasonNumber)}
                />
                <button
                  type="button"
                  onClick={() => onActiveSeasonChange(season.seasonNumber)}
                  className="truncate text-left text-xs font-medium text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {season.seasonNumber === 0
                    ? 'Specials'
                    : `Season ${season.seasonNumber}`}
                </button>
                <span className="text-center text-xs text-gray-400">
                  {season.episodeCount}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="refreshed-inset-surface min-w-0 rounded-lg border border-gray-700 p-2">
        <div className="grid grid-cols-[1.25rem_4.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-600 px-1 pb-2 text-xs font-semibold text-gray-200">
          <SelectCircle
            selected={allEpisodesSelected}
            disabled={activeSeason < 0 || episodeNumbers.length === 0}
            label={
              allEpisodesSelected ? 'Clear all episodes' : 'Select all episodes'
            }
            onClick={toggleAllEpisodes}
          />
          <span>Episodes</span>
          <span>Title</span>
        </div>
        <div className="max-h-[214px] space-y-0.5 overflow-y-auto pr-1 pt-1">
          {!data && !error && activeSeason >= 0 && (
            <div className="flex h-20 items-center justify-center">
              <LoadingSpinner />
            </div>
          )}
          {activeSeason < 0 && (
            <p className="px-1 py-2 text-xs text-gray-400">
              Select a season to view its episodes.
            </p>
          )}
          {error && (
            <p className="px-1 py-2 text-xs text-red-300">
              Episodes could not be loaded. Try selecting the season again.
            </p>
          )}
          {data?.episodes.map((episode) => {
            const disabled = blockedEpisodes.includes(episode.episodeNumber);
            const selected =
              disabled ||
              (!!activeSelection &&
                (activeSelection.episodeNumbers === undefined ||
                  activeSelection.episodeNumbers.includes(
                    episode.episodeNumber
                  )));
            return (
              <div
                key={episode.id}
                className="grid w-full grid-cols-[1.25rem_4.5rem_minmax(0,1fr)] items-center gap-x-2 rounded px-1 py-1 hover:bg-indigo-500/15"
              >
                <SelectCircle
                  selected={selected}
                  disabled={disabled}
                  label={`${selected ? 'Clear' : 'Select'} Episode ${episode.episodeNumber}`}
                  onClick={() => toggleEpisode(episode.episodeNumber)}
                />
                <span className="text-xs font-medium text-gray-100">
                  Episode {episode.episodeNumber}
                </span>
                <span className="truncate text-xs text-gray-400">
                  {episode.name || 'Untitled'}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default SeriesSeasonEpisodeSelector;
