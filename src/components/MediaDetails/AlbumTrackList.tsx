import defineMessages from '@app/utils/defineMessages';
import type { MusicDetails } from '@server/models/Music';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.AlbumTrackList', {
  track: 'Track',
  title: 'Title',
  runtime: 'Runtime',
  notAvailable: 'Not available',
  noTracks: 'No Tracks Available',
});

interface AlbumTrackListProps {
  tracks: MusicDetails['tracks'];
  twoColumnsOnly?: boolean;
}

const AlbumTrackList = ({
  tracks,
  twoColumnsOnly = false,
}: AlbumTrackListProps) => {
  const intl = useIntl();
  const notAvailable = intl.formatMessage(messages.notAvailable);

  if (tracks.length === 0) {
    return (
      <p className="mt-2 text-xs text-gray-500">
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
      {layouts.map(({ columns, className }) => (
        <div
          key={`${columns.length}-${className}`}
          className={`mt-2 max-h-[214px] gap-2 overflow-y-auto pr-1 ${className}`}
        >
          {columns.map((columnTracks, columnIndex) => (
            <section
              key={`track-column-${columnIndex}`}
              className="refreshed-inset-surface rounded-lg border border-gray-700 p-2"
            >
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_4rem] items-center gap-x-2 border-b border-gray-600 px-1 pb-2 text-xs font-semibold text-gray-200">
                <span>{intl.formatMessage(messages.track)}</span>
                <span>{intl.formatMessage(messages.title)}</span>
                <span className="text-center">
                  {intl.formatMessage(messages.runtime)}
                </span>
              </div>
              <div className="space-y-0.5 pt-1">
                {columnTracks.map((track, trackIndex) => (
                  <div
                    key={`${track.recordingMbid || track.name}-${track.position}-${trackIndex}`}
                    className="grid min-h-[24px] grid-cols-[2.25rem_minmax(0,1fr)_4rem] items-center gap-x-2 px-1"
                  >
                    <span className="text-xs font-medium text-gray-100">
                      {track.position || trackIndex + 1}
                    </span>
                    <span className="truncate text-xs text-gray-400">
                      {track.name || notAvailable}
                    </span>
                    <span className="text-center text-xs text-gray-400">
                      {formatRuntime(track.length)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}
    </>
  );
};

export default AlbumTrackList;
