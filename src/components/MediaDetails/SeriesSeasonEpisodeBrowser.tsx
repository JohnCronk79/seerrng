import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MediaDetails.SeriesBrowser', {
  season: 'Season',
  episodes: 'Episodes',
  episode: 'Episode',
  title: 'Title',
  specials: 'Specials',
  seasonNumber: 'Season {number}',
  episodeNumber: 'Episode {number}',
  untitled: 'Untitled',
  noSeasons: 'No Seasons Available',
  selectSeason: 'Select a season to view its episodes',
  loadError: 'Episodes could not be loaded. Try selecting the season again.',
});

interface SeriesSeasonEpisodeBrowserProps {
  tvId: number;
  seasons: TvDetails['seasons'];
}

const SeriesSeasonEpisodeBrowser = ({
  tvId,
  seasons,
}: SeriesSeasonEpisodeBrowserProps) => {
  const intl = useIntl();
  const visibleSeasons = useMemo(
    () => seasons.filter((season) => season.episodeCount > 0),
    [seasons]
  );
  const [activeSeason, setActiveSeason] = useState(
    visibleSeasons.find((season) => season.seasonNumber > 0)?.seasonNumber ??
      visibleSeasons[0]?.seasonNumber ??
      -1
  );

  useEffect(() => {
    if (
      !visibleSeasons.some((season) => season.seasonNumber === activeSeason)
    ) {
      setActiveSeason(
        visibleSeasons.find((season) => season.seasonNumber > 0)
          ?.seasonNumber ??
          visibleSeasons[0]?.seasonNumber ??
          -1
      );
    }
  }, [activeSeason, visibleSeasons]);

  const { data, error } = useSWR<SeasonWithEpisodes>(
    activeSeason >= 0 ? `/api/v1/tv/${tvId}/season/${activeSeason}` : null
  );

  return (
    <div className="mt-[5px] grid min-w-0 gap-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
      <section className="refreshed-inset-surface min-w-[12rem] rounded-lg border border-gray-700 p-2">
        <div className="grid grid-cols-[minmax(5.5rem,1fr)_4rem] items-center gap-x-2 border-b border-gray-600 px-1 pb-2 text-xs font-semibold text-gray-200">
          <span>{intl.formatMessage(messages.season)}</span>
          <span className="text-center">
            {intl.formatMessage(messages.episodes)}
          </span>
        </div>
        <div
          className="max-h-[214px] space-y-0.5 overflow-y-auto pr-1 pt-1"
          data-testid="season-list"
        >
          {visibleSeasons.length === 0 && (
            <p className="px-1 py-2 text-xs text-gray-400">
              {intl.formatMessage(messages.noSeasons)}
            </p>
          )}
          {visibleSeasons.map((season) => (
            <button
              type="button"
              key={season.seasonNumber}
              onClick={() => setActiveSeason(season.seasonNumber)}
              aria-pressed={activeSeason === season.seasonNumber}
              className={`grid w-full grid-cols-[minmax(5.5rem,1fr)_4rem] items-center gap-x-2 rounded px-1 py-1 text-left transition hover:bg-indigo-500/15 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                activeSeason === season.seasonNumber ? 'bg-indigo-500/15' : ''
              }`}
            >
              <span className="truncate text-xs font-medium text-gray-100">
                {season.seasonNumber === 0
                  ? intl.formatMessage(messages.specials)
                  : intl.formatMessage(messages.seasonNumber, {
                      number: season.seasonNumber,
                    })}
              </span>
              <span className="text-center text-xs text-gray-400">
                {season.episodeCount}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="refreshed-inset-surface min-w-0 rounded-lg border border-gray-700 p-2">
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-gray-600 px-1 pb-2 text-xs font-semibold text-gray-200">
          <span>{intl.formatMessage(messages.episode)}</span>
          <span>{intl.formatMessage(messages.title)}</span>
        </div>
        <div
          className="max-h-[214px] space-y-0.5 overflow-y-auto pr-1 pt-1"
          data-testid="episode-list"
        >
          {!data && !error && activeSeason >= 0 && (
            <div className="flex h-20 items-center justify-center">
              <LoadingSpinner />
            </div>
          )}
          {activeSeason < 0 && (
            <p className="px-1 py-2 text-xs text-gray-400">
              {intl.formatMessage(messages.selectSeason)}
            </p>
          )}
          {error && (
            <p className="px-1 py-2 text-xs text-red-300">
              {intl.formatMessage(messages.loadError)}
            </p>
          )}
          {data?.episodes.map((episode) => (
            <div
              key={episode.id}
              className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 rounded px-1 py-1"
            >
              <span className="text-xs font-medium text-gray-100">
                {intl.formatMessage(messages.episodeNumber, {
                  number: episode.episodeNumber,
                })}
              </span>
              <span className="truncate text-xs text-gray-400">
                {episode.name || intl.formatMessage(messages.untitled)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default SeriesSeasonEpisodeBrowser;
