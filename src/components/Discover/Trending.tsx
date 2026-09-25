import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import DiscoverBooks from '@app/components/Discover/DiscoverBooks';
import DiscoverMediaTabs, {
  type DiscoverMediaType,
} from '@app/components/Discover/DiscoverMediaTabs';
import DiscoverMovies from '@app/components/Discover/DiscoverMovies';
import DiscoverMusic from '@app/components/Discover/DiscoverMusic';
import DiscoverTv from '@app/components/Discover/DiscoverTv';
import useDiscover from '@app/hooks/useDiscover';
import defineMessages from '@app/utils/defineMessages';
import type { Results } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useMemo, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover', {
  trending: 'Trending Media',
});

const TrendingAll = ({
  title,
  mediaFilters,
}: {
  title: string;
  mediaFilters: ReactNode;
}) => {
  const video = useDiscover<Results>('/api/v1/discover/trending', {
    mediaType: 'all',
  });
  const music = useDiscover<Results>('/api/v1/discover/music', {
    days: '14',
    sortBy: 'popular.week',
  });
  const books = useDiscover<Results>('/api/v1/discover/books', {
    sortBy: 'trending',
    responseVersion: 2,
  });
  const items = useMemo(() => {
    const sources = [
      video.titles.filter(
        (item) => item.mediaType === 'movie' || item.mediaType === 'tv'
      ),
      music.titles,
      books.titles,
    ];
    const combined: Results[] = [];
    for (
      let index = 0;
      index < Math.max(...sources.map((items) => items.length));
      index++
    ) {
      for (const source of sources) {
        if (source[index]) combined.push(source[index]);
      }
    }
    return combined;
  }, [video.titles, music.titles, books.titles]);
  const sources = [video, music, books];
  const isLoading = sources.some((source) => source.isLoadingMore);
  const isReachingEnd = sources.every(
    (source) => source.isReachingEnd || Boolean(source.error)
  );

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {mediaFilters}
      </div>
      <ListView
        items={items}
        isEmpty={sources.every(
          (source) => source.isEmpty || Boolean(source.error)
        )}
        isLoading={isLoading}
        isReachingEnd={isReachingEnd}
        onScrollBottom={() => {
          sources.forEach((source) => {
            if (
              !source.isReachingEnd &&
              !source.isLoadingMore &&
              !source.isValidating &&
              !source.error
            ) {
              source.fetchMore();
            }
          });
        }}
      />
    </>
  );
};

const Trending = () => {
  const intl = useIntl();
  const router = useRouter();
  const mediaType: DiscoverMediaType =
    router.query.mediaType === 'movie' ||
    router.query.mediaType === 'tv' ||
    router.query.mediaType === 'music' ||
    router.query.mediaType === 'book' ||
    router.query.mediaType === 'audiobook'
      ? router.query.mediaType
      : 'all';
  const title = intl.formatMessage(messages.trending);
  const mediaFilters = (
    <DiscoverMediaTabs selected={mediaType} basePath="/discover/trending" />
  );

  switch (mediaType) {
    case 'all':
      return <TrendingAll title={title} mediaFilters={mediaFilters} />;
    case 'tv':
      return (
        <DiscoverTv
          titleOverride={title}
          initialFilters={{ sortBy: 'popularity.desc' }}
          randomizeOrder={false}
          mediaFilters={mediaFilters}
        />
      );
    case 'music':
      return (
        <DiscoverMusic titleOverride={title} mediaFilters={mediaFilters} />
      );
    case 'book':
    case 'audiobook':
      return (
        <DiscoverBooks
          format={mediaType === 'audiobook' ? 'audiobook' : 'ebook'}
          defaultSortBy="trending"
          titleOverride={title}
          mediaFilters={mediaFilters}
          showFormatTabs={false}
        />
      );
    default:
      return (
        <DiscoverMovies
          titleOverride={title}
          initialFilters={{ sortBy: 'popularity.desc' }}
          randomizeOrder={false}
          mediaFilters={mediaFilters}
        />
      );
  }
};

export default Trending;
