import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Media.JellystatWatchSummary', {
  title: 'Jellystat Watch Activity',
  plays: '{count, plural, one {# play} other {# plays}}',
  playbackTime: '{hours} hours of playback',
});

interface JellystatPlayback {
  plays: number;
  playbackSeconds: number;
}

/**
 * Lifetime play count and playback time from Jellystat. Renders nothing when
 * Jellystat is not configured, the title has no Jellyfin link, or the lookup
 * fails, so the rest of the page is unaffected.
 */
const JellystatWatchSummary = ({ mediaId }: { mediaId: number }) => {
  const intl = useIntl();
  const { data } = useSWR<JellystatPlayback>(
    `/api/v1/media/${mediaId}/jellystat`
  );

  if (!data) {
    return null;
  }

  const hours = data.playbackSeconds / 3600;

  return (
    <section aria-label={intl.formatMessage(messages.title)}>
      <h3 className="card-title">{intl.formatMessage(messages.title)}</h3>
      <p className="card-body-text">
        {intl.formatMessage(messages.plays, { count: data.plays })}
        {' · '}
        {intl.formatMessage(messages.playbackTime, {
          hours: intl.formatNumber(hours, { maximumFractionDigits: 1 }),
        })}
      </p>
    </section>
  );
};

export default JellystatWatchSummary;
