import MediaFilterOption from '@app/components/Discover/MediaFilterOption';
import PinnedFilterSection from '@app/components/Discover/PinnedFilterSection';
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
    <PinnedFilterSection
      mediaType={selected === 'audiobook' ? 'book' : (selected ?? 'movie')}
      section="mediaFilters"
      label={intl.formatMessage(messages.mediaFilters)}
    >
      <nav className="flex flex-wrap gap-2" data-testid="discover-media-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = selected === tab.type;

          return (
            <MediaFilterOption
              key={tab.type}
              pin={pin}
              value={tab.type}
              label={intl.formatMessage(tab.label)}
              selected={isSelected}
            >
              <Link
                href={
                  basePath
                    ? { pathname: basePath, query: { mediaType: tab.type } }
                    : tab.href
                }
                aria-current={isSelected ? 'page' : undefined}
                className="flex h-full items-center gap-1.5 px-2 focus:ring-2 focus:ring-indigo-400 focus:outline-none focus:ring-inset"
                data-testid={`discover-media-tab-${tab.type}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage(tab.label)}</span>
              </Link>
            </MediaFilterOption>
          );
        })}
      </nav>
    </PinnedFilterSection>
  );
};

export default DiscoverMediaTabs;
