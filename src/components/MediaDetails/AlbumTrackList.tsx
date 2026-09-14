import SelectionCircle from '@app/components/Common/SelectionCircle';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import {
  CheckCircleIcon,
  ServerStackIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import type { MusicDetails } from '@server/models/Music';
import type { PlaybackCatalogResponse } from '@server/models/Playback';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.AlbumTrackList', {
  track: 'Track',
  title: 'Title',
  runtime: 'Runtime',
  notAvailable: 'Not available',
  noTracks: 'No Tracks Available',
  album: 'Album',
  selection: 'Select items to play',
  availabilityLegend: 'Green check: available. Red X: not available.',
});

interface AlbumTrackListProps {
  tracks: MusicDetails['tracks'];
  twoColumnsOnly?: boolean;
  catalog?: PlaybackCatalogResponse;
  selectedItemIds?: string[];
  onSelectionChange?: (itemIds: string[]) => void;
}

const AlbumTrackList = ({
  tracks,
  twoColumnsOnly = false,
  catalog,
  selectedItemIds = [],
  onSelectionChange,
}: AlbumTrackListProps) => {
  const intl = useIntl();
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const selection = new Set(selectedItemIds);
  const playableTracks = catalog?.groups[0]?.items ?? [];
  const allSelected =
    playableTracks.length > 0 &&
    playableTracks.every((item) => selection.has(item.id));
  const toggleAllTracks = () => {
    if (!onSelectionChange || playableTracks.length === 0) {
      return;
    }
    onSelectionChange(
      allSelected
        ? selectedItemIds.filter(
            (itemId) => !playableTracks.some((item) => item.id === itemId)
          )
        : [
            ...new Set([
              ...selectedItemIds,
              ...playableTracks.map((item) => item.id),
            ]),
          ]
    );
  };
  const toggleTrack = (itemId: string) => {
    if (!onSelectionChange) {
      return;
    }
    const next = new Set(selection);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    onSelectionChange([...next]);
  };
  const AvailabilityHeading = () => (
    <Tooltip content={intl.formatMessage(messages.availabilityLegend)}>
      <span
        className="media-availability-cell"
        aria-label={intl.formatMessage(messages.availabilityLegend)}
      >
        <ServerStackIcon className="h-4 w-4" />
      </span>
    </Tooltip>
  );
  const AvailabilityIcon = ({ available }: { available: boolean }) => (
    <span className="media-availability-cell">
      {available ? (
        <CheckCircleIcon className="h-4 w-4 text-green-400" aria-hidden />
      ) : (
        <XCircleIcon className="h-4 w-4 text-red-400" aria-hidden />
      )}
    </span>
  );

  if (tracks.length === 0) {
    return (
      <p className="refreshed-detail-text-muted mt-2 text-xs">
        {intl.formatMessage(messages.noTracks)}
      </p>
    );
  }

  const splitTracks = (columnCount: number) => {
    const columnSize = Math.ceil(tracks.length / columnCount);

    return Array.from({ length: columnCount }, (_, index) =>
      tracks.slice(index * columnSize, (index + 1) * columnSize)
    );
  };
  const layouts = twoColumnsOnly
    ? [
        {
          columns: splitTracks(2),
          className: 'grid grid-cols-1 card:grid-cols-2',
        },
      ]
    : [
        {
          columns: splitTracks(2),
          className: 'grid grid-cols-2 lg:hidden',
        },
        {
          columns: splitTracks(3),
          className: 'hidden grid-cols-3 lg:grid',
        },
      ];

  const formatRuntime = (length: number) => {
    if (!Number.isFinite(length) || length <= 0) {
      return notAvailable;
    }

    const totalSeconds = Math.round(length / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div className="refreshed-inset-surface mt-2 grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200">
        <SelectionCircle
          disabled={playableTracks.length === 0}
          onClick={toggleAllTracks}
          selected={allSelected}
          label={intl.formatMessage(messages.selection)}
        />
        <span>{intl.formatMessage(messages.album)}</span>
        <AvailabilityHeading />
      </div>
      {layouts.map(({ columns, className }) => (
        <div
          key={`${columns.length}-${className}`}
          className={`mt-2 max-h-[214px] gap-2 overflow-y-auto pr-1 ${className}`}
        >
          {columns.map((columnTracks, columnIndex) => {
            const columnItemIds = columnTracks.flatMap((track) => {
              const position = track.position || tracks.indexOf(track) + 1;
              const item = playableTracks.find(
                (candidate) => candidate.index === position
              );
              return item ? [item.id] : [];
            });
            const columnAllSelected =
              columnItemIds.length > 0 &&
              columnItemIds.every((itemId) => selection.has(itemId));

            return (
              <section
                key={`track-column-${columnIndex}`}
                className="refreshed-inset-surface rounded-lg border border-gray-700 p-2"
              >
                <div className="request-divider-dark grid grid-cols-[2rem_2.25rem_minmax(0,1fr)_4rem_2.5rem] items-center gap-x-2 border-b px-1 pb-2 text-xs font-semibold text-gray-200">
                  <SelectionCircle
                    disabled={columnItemIds.length === 0}
                    onClick={() => {
                      if (!onSelectionChange) return;
                      const next = new Set(selection);
                      columnItemIds.forEach((itemId) =>
                        columnAllSelected
                          ? next.delete(itemId)
                          : next.add(itemId)
                      );
                      onSelectionChange([...next]);
                    }}
                    selected={columnAllSelected}
                    label={intl.formatMessage(messages.selection)}
                  />
                  <span className="text-left">
                    {intl.formatMessage(messages.track)}
                  </span>
                  <span className="text-left">
                    {intl.formatMessage(messages.title)}
                  </span>
                  <span className="text-center">
                    {intl.formatMessage(messages.runtime)}
                  </span>
                  <AvailabilityHeading />
                </div>
                <div className="space-y-0.5 pt-1">
                  {columnTracks.map((track, trackIndex) => {
                    const position =
                      track.position || tracks.indexOf(track) + 1;
                    const playableItem = playableTracks.find(
                      (item) => item.index === position
                    );
                    const selected = playableItem
                      ? selection.has(playableItem.id)
                      : false;
                    return (
                      <div
                        key={`${track.recordingMbid || track.name}-${track.position}-${trackIndex}`}
                        className="grid min-h-[24px] grid-cols-[2rem_2.25rem_minmax(0,1fr)_4rem_2.5rem] items-center gap-x-2 px-1"
                      >
                        <SelectionCircle
                          disabled={!playableItem}
                          onClick={() =>
                            playableItem && toggleTrack(playableItem.id)
                          }
                          selected={selected}
                          label={intl.formatMessage(messages.selection)}
                        />
                        <span className="text-xs font-medium text-gray-100">
                          {position}
                        </span>
                        <span className="refreshed-detail-text truncate text-xs">
                          {track.name || notAvailable}
                        </span>
                        <span className="refreshed-detail-text text-center text-xs">
                          {formatRuntime(track.length)}
                        </span>
                        <AvailabilityIcon available={!!playableItem} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ))}
    </>
  );
};

export default AlbumTrackList;
