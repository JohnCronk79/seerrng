import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import CollectionSummaryCard from './CollectionSummaryCard';

const state = vi.hoisted(() => ({
  collection: undefined as unknown,
  genres: undefined as unknown,
  error: undefined as Error | undefined,
  keys: [] as (string | null)[],
}));

vi.mock('swr', () => ({
  default: (key: string | null) => {
    state.keys.push(key);
    return {
      data: key?.includes('/collection')
        ? state.collection
        : key
          ? state.genres
          : undefined,
      error: key?.includes('/collection') ? state.error : undefined,
      mutate: vi.fn(),
    };
  },
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@app/components/Common/CachedImage', () => ({
  default: ({ src }: { src: string }) => <img src={src} alt="" />,
}));
vi.mock('@app/components/Common/Button', () => ({
  default: ({ children }: React.ComponentProps<'button'>) => (
    <button>{children}</button>
  ),
}));

const render = () =>
  renderToStaticMarkup(
    <IntlProvider locale="en">
      <CollectionSummaryCard
        collection={{
          id: 86066,
          name: 'Minions test collection',
          posterPath: '/poster.jpg',
        }}
      />
    </IntlProvider>
  );

beforeEach(() => {
  vi.stubGlobal('React', React);
  state.keys = [];
  state.error = undefined;
  state.collection = {
    id: 86066,
    name: 'Minions test collection',
    overview: 'Collection overview fixture.',
    posterPath: '/collection-poster.jpg',
    backdropPath: '/unused-backdrop.jpg',
    parts: [{ genreIds: [16, 35] }, { genreIds: [35, 10751] }],
  };
  state.genres = [
    { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' },
    { id: 10751, name: 'Family' },
  ];
});

it('uses collection-page data with linked title/poster, unique genres and overview', () => {
  const html = render();
  expect(state.keys).toEqual([
    '/api/v1/collection/86066',
    '/api/v1/genres/movie',
  ]);
  expect(html.match(/href="\/collection\/86066"/g)).toHaveLength(2);
  expect(html).toContain('collection-summary-size-value">2</dd>');
  expect(html.match(/>Comedy<\/a>/g)).toHaveLength(1);
  expect(html).toContain('Animation');
  expect(html).toContain('Family');
  expect(html).toContain('Collection overview fixture.');
  expect(html).not.toContain('unused-backdrop');
  expect(html).toContain(
    'collection-summary-overview-value">Collection overview fixture.</dd>'
  );
  expect(html).toContain(
    'detail-item-surface detail-summary-card media-detail-collection-card'
  );
  expect(html.match(/<section\b/g)).toHaveLength(1);
  expect(html.match(/detail-item-surface/g)).toHaveLength(1);
  expect(html).not.toContain('refreshed-inset-surface');
  expect(html).not.toContain('refreshed-card-surface');
});

it('keeps the entire long overview before the final genre and size rows', () => {
  const overview = 'A long collection overview. '.repeat(100);
  state.collection = { id: 86066, name: 'Long overview', overview, parts: [] };
  const html = render();
  expect(html).toContain(overview);
  expect(html.indexOf('collection-summary-overview-label')).toBeLessThan(
    html.indexOf('collection-summary-genres-label')
  );
  expect(html.indexOf('collection-summary-genres-label')).toBeLessThan(
    html.indexOf('collection-summary-size-label')
  );
  expect(html).not.toContain('collection-summary-overview-text');
});

it('shows loading instead of inventing collection size or overview', () => {
  state.collection = undefined;
  const html = render();
  expect(html).toContain('Loading collection details');
  expect(html).toContain('collection-summary-size-value">—</dd>');
  expect(html).not.toContain('Overview unavailable');
});

it('shows a retry on failure and retains the collection links', () => {
  state.collection = undefined;
  state.error = new Error('Unavailable');
  const html = render();
  expect(html).toContain('Unable to load collection details.');
  expect(html).toContain('Retry');
  expect(html.match(/href="\/collection\/86066"/g)).toHaveLength(2);
});

it('handles empty collections and missing poster/overview safely', () => {
  state.collection = { id: 86066, name: 'Empty', parts: [] };
  const html = render();
  expect(html).toContain('collection-summary-size-value">0</dd>');
  expect(html).toContain('Not Available');
  expect(html).toContain('Overview unavailable');
});

it('uses the resolved music collection cover instead of an unverified first member URL', () => {
  state.collection = {id:'artist',kind:'music',name:'Artist Collection',posterPath:'https://archive.org/verified.jpg',parts:[{posterPath:'https://coverartarchive.org/missing.jpg',genres:[]}]};
  const html=renderToStaticMarkup(<IntlProvider locale="en"><CollectionSummaryCard kind="music" collection={{id:'artist',name:'Artist Collection'}}/></IntlProvider>);
  expect(html).toContain('https://archive.org/verified.jpg');
  expect(html).not.toContain('https://coverartarchive.org/missing.jpg');
});

it.each(['tv', 'music'] as const)(
  'shares the movie layout for %s collection summaries',
  (kind) => {
    state.collection = {
      id: '7502',
      kind,
      name: 'Yellowstone Collection',
      overview: 'The full collection overview.',
      parts: [
        {
          posterPath:
            kind === 'tv'
              ? '/show.jpg'
              : 'https://coverartarchive.org/album.jpg',
          genres: ['Drama'],
          genreIds: [18],
        },
        { genres: ['Drama', 'Western'], genreIds: [18, 37] },
      ],
    };
    const html = renderToStaticMarkup(
      <IntlProvider locale="en">
        <CollectionSummaryCard
          kind={kind}
          collection={{ id: '7502', name: 'Yellowstone Collection' }}
        />
      </IntlProvider>
    );
    expect(state.keys).toEqual([
      `/api/v1/collection-catalog/${kind}/7502`,
      null,
    ]);
    expect(
      html.match(new RegExp(`href="/collections/${kind}/7502"`, 'g'))
    ).toHaveLength(2);
    expect(html).toContain('collection-summary-size-value">2</dd>');
    expect(html).toContain(
      `href="/discover/${kind}?genre=${kind === 'tv' ? '18' : 'Drama'}">Drama</a>`
    );
    expect(html).toContain(
      `href="/discover/${kind}?genre=${kind === 'tv' ? '37' : 'Western'}">Western</a>`
    );
    expect(html.match(/>Drama<\/a>/g)).toHaveLength(1);
    expect(html).toContain('The full collection overview.');
    expect(html).toContain(
      'detail-item-surface detail-summary-card media-detail-collection-card'
    );
    expect(html.match(/<section\b/g)).toHaveLength(1);
  }
);
