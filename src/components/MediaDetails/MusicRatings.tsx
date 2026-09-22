import MusicBrainzLogo from '@app/assets/musicbrainz.svg';
import LidarrLogo from '@app/assets/services/lidarr.svg';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import type { DisplayMusicRating } from '@app/utils/musicRatings';
import { getSafeHref } from '@app/utils/safeUrl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MusicRatings', {
  score: '{source}: {score}/{scale} from {votes} votes.',
  average:
    '{source}: {score}/{scale}, average of {count} rated albums out of {total}. Missing ratings are excluded.',
  absent: '{source}: no rating available.',
  edition:
    'Discogs rating is for the linked release or the master entry’s main release, not every edition.',
});
const names = {
  musicbrainz: 'MusicBrainz',
  lidarr: 'Lidarr',
  theaudiodb: 'TheAudioDB',
  discogs: 'Discogs',
};
export default function MusicRatings({
  ratings = [],
  total,
}: {
  ratings?: DisplayMusicRating[];
  total?: number;
}) {
  const intl = useIntl();
  const sources = (
    ['musicbrainz', 'lidarr', 'theaudiodb', 'discogs'] as const
  ).filter((source) =>
    source === 'lidarr'
      ? ratings.some((rating) => rating.source === source)
      : source !== 'musicbrainz' ||
        !ratings.some((rating) => rating.source === 'lidarr') ||
        ratings.some((rating) => rating.source === 'musicbrainz')
  );
  return (
    <>
      {sources.map((source) => {
        const rating = ratings.find((value) => value.source === source);
        const scale = rating?.scale ?? (source === 'discogs' ? 5 : 10);
        const title =
          (rating
            ? intl.formatMessage(
                total === undefined ? messages.score : messages.average,
                {
                  source: names[source],
                  score: intl.formatNumber(rating.score, {
                    maximumFractionDigits: 1,
                  }),
                  scale,
                  votes: intl.formatNumber(rating.votes),
                  count: rating.ratedAlbums ?? 0,
                  total: total ?? 0,
                }
              )
            : intl.formatMessage(messages.absent, { source: names[source] })) +
          (source === 'discogs'
            ? ' ' + intl.formatMessage(messages.edition)
            : '');
        const content = (
          <>
            {source === 'musicbrainz' ? (
              <MusicBrainzLogo className="media-rating-icon" aria-hidden />
            ) : source === 'lidarr' ? (
              <LidarrLogo className="media-rating-icon" aria-hidden />
            ) : (
              <span className="music-rating-source">{names[source]}</span>
            )}
            <span className="media-rating-value">
              {rating
                ? `${intl.formatNumber(rating.score, { maximumFractionDigits: 1 })}/${scale}`
                : '—'}
            </span>
          </>
        );
        const href = getSafeHref(rating?.url);
        return (
          <Tooltip key={source} content={title}>
            {href ? (
              <a
                className="media-rating-link"
                aria-label={title}
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {content}
              </a>
            ) : (
              <span className="media-rating-link" aria-label={title}>
                {content}
              </span>
            )}
          </Tooltip>
        );
      })}
    </>
  );
}
