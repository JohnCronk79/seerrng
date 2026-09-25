import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import MediaFilterPin from '@app/components/Discover/MediaFilterPin';
import useMediaFilterPin from '@app/hooks/useMediaFilterPin';
import defineMessages from '@app/utils/defineMessages';
import {
  BookOpenIcon,
  FilmIcon,
  MusicalNoteIcon,
  SpeakerWaveIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

export type DiscoverMediaType = 'movie' | 'tv' | 'music' | 'book' | 'audiobook';

interface DiscoverMediaTabsProps {
  selected?: DiscoverMediaType;
  basePath?: string;
}

const messages = defineMessages('components.Discover.DiscoverMediaTabs', {
  mediaFilters: 'Media Filters',
  movies: 'Movies',
  series: 'Series',
  music: 'Music',
  books: 'Books',
  audiobooks: 'Audiobooks',
});

const tabs = [
  {
    type: 'movie',
    label: messages.movies,
    icon: FilmIcon,
    href: '/discover/movies',
  },
  { type: 'tv', label: messages.series, icon: TvIcon, href: '/discover/tv' },
  {
    type: 'music',
    label: messages.music,
    icon: MusicalNoteIcon,
    href: '/discover/music',
  },
  {
    type: 'book',
    label: messages.books,
    icon: BookOpenIcon,
    href: '/discover/books',
  },
  {
    type: 'audiobook',
    label: messages.audiobooks,
    icon: SpeakerWaveIcon,
    href: '/discover/audiobooks',
  },
] as const;

const DiscoverMediaTabs = ({ selected, basePath }: DiscoverMediaTabsProps) => {
  const intl = useIntl();
  const router = useRouter();
  const pin = useMediaFilterPin<DiscoverMediaType>({
    scope: 'trending',
    selected: selected ?? 'movie',
    values: tabs.map((tab) => tab.type),
    ready: router.isReady && Boolean(basePath),
    explicit: Boolean(router.query.mediaType),
    restore: (value) => {
      void router.replace({
        pathname: basePath,
        query: { ...router.query, mediaType: value },
      });
    },
  });

  return (
    <section aria-label={intl.formatMessage(messages.mediaFilters)}>
      <div className="app-filter-section-heading">
        {intl.formatMessage(messages.mediaFilters)}
      </div>
      <nav className="flex flex-wrap gap-2" data-testid="discover-media-tabs">
        {basePath && <MediaFilterPin pin={pin} />}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = selected === tab.type;

          return (
            <Link
              key={tab.type}
              onClick={() => pin.remember(tab.type)}
              href={
                basePath
                  ? { pathname: basePath, query: { mediaType: tab.type } }
                  : tab.href
              }
              aria-current={isSelected ? 'page' : undefined}
              className={getFilterToggleButtonClass(isSelected)}
              data-testid={`discover-media-tab-${tab.type}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage(tab.label)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
};

export default DiscoverMediaTabs;
