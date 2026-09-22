import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { afterEach, expect, it, vi } from 'vitest';
import CuratedCollectionDetails from './CuratedCollectionDetails';

const state = vi.hoisted(() => ({
  collection: {
    name: 'Test Collection',
    overview: 'Artist overview.',
    sourceUrl: 'https://musicbrainz.org',
    parts: [
      {
        id: 'studio',
        title: 'Studio',
        releaseDate: '1998',
        genres: ['pop'],
        primaryType: 'Album',
        secondaryTypes: [],
        mediaInfo: { id: 1, ratingKeyMp3: '1' },
      },
      {
        id: 'live',
        title: 'Live',
        releaseDate: '2000',
        genres: ['rock'],
        primaryType: 'Album',
        secondaryTypes: ['Live', 'Compilation'],
        mediaInfo: { id: 2, ratingKeyMp3: '2' },
      },
    ],
  },
}));
vi.mock('swr', () => ({
  default: (key: string) => ({
    data: key?.includes('collection-catalog') ? state.collection : undefined,
  }),
}));
vi.mock('@app/hooks/useCollectionAvailability', () => ({
  default: () => ({}),
}));
vi.mock('@app/hooks/useCuratedRatings', () => ({
  default: () => ({ members: [], loading: false }),
}));
vi.mock('@app/components/Common/CachedImage', () => ({ default: () => null }));
vi.mock('@app/components/Common/PageTitle', () => ({ default: () => null }));
vi.mock('@app/components/MediaDetails/MediaDetailArtwork', () => ({
  default: () => null,
}));
vi.mock('@app/components/MediaDetails/MediaQualitySelect', () => ({
  default: () => null,
}));
vi.mock('@app/components/MediaDetails/MusicRatings', () => ({
  default: () => null,
}));
vi.mock('./CollectionRatings', () => ({ default: () => null }));
vi.mock('./CollectionOverview', () => ({ default: () => null }));
vi.mock('./CuratedGenreLinks', () => ({ default: () => null }));
vi.mock('./CollectionPlayOnDeviceButton', () => ({
  default: ({ mediaIds }: { mediaIds: number[] }) => (
    <output data-testid="device">{mediaIds.join(',')}</output>
  ),
}));
vi.mock('@app/components/Common/MediaServerPlayButton', () => ({
  default: ({ collectionMediaIds }: { collectionMediaIds: number[] }) => (
    <output data-testid="play">{collectionMediaIds.join(',')}</output>
  ),
}));
vi.mock('./CollectionServerActions', () => ({
  default: ({ selectedIds }: { selectedIds: string[] }) => (
    <output data-testid="add" className="collection-server-actions">
      {selectedIds.join(',')}
    </output>
  ),
}));
vi.mock('@app/components/Common/ThreeItemScroll', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('./CuratedMemberCard', () => ({
  default: ({
    part,
    selected,
    toggle,
  }: {
    part: { id: string };
    selected: boolean;
    toggle: () => void;
  }) => (
    <button data-member={part.id} aria-pressed={selected} onClick={toggle}>
      {part.id}
    </button>
  ),
}));
vi.mock('@app/components/Discover/FilterPanel/CompactFilterSelect', () => ({
  getFilterResetButtonClass: () => 'app-filter-button',
  CompactSelect: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
it('keeps all actions scoped to shown selections and does not revive hidden selections', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.getElementById('root')!);
  const output = (name: string) =>
    document.querySelector(`[data-testid="${name}"]`)?.textContent;
  const click = async (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === label
      )!;
      button.click();
    });
  const filter = async (label: string, value: string) =>
    act(async () => {
      const select = document.querySelector(
        `select[aria-label="${label}"]`
      ) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  try {
    await act(async () =>
      root.render(
        <IntlProvider locale="en">
          <CuratedCollectionDetails kind="music" id="artist" />
        </IntlProvider>
      )
    );
    expect(output('add')).toBe('studio,live');
    expect(
      document.querySelectorAll(
        '.music-collection-action-row .app-button-association'
      )
    ).toHaveLength(2);
    const types = document.querySelector('select[aria-label="Release Type"]')!;
    expect(types.querySelectorAll('option')).toHaveLength(18);
    await filter('Release Type', 'Live');
    expect(output('add')).toBe('live');
    await filter('Release Type', 'Compilation');
    expect(output('add')).toBe('live');
    expect(output('play')).toBe('2');
    expect(output('device')).toBe('2');
    expect(document.querySelector('[data-member="studio"]')).toBeNull();
    await click('Clear Selection');
    expect(output('add')).toBe('');
    await click('Select All');
    expect(output('add')).toBe('live');
    await filter('Genres', 'pop');
    expect(output('add')).toBe('');
    expect(output('play')).toBe('');
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      'No items match these filters.'
    );
    await click('Clear Filters');
    expect(output('add')).toBe('');
    expect(document.querySelectorAll('[data-member]')).toHaveLength(2);
    await click('Select All');
    expect(output('add')).toBe('studio,live');
    await filter('Release Type', 'Album');
    expect(output('add')).toBe('studio');
    expect(document.querySelector('[data-member="live"]')).toBeNull();
    await click('Clear Filters');
    expect(output('add')).toBe('studio');
    await click('Select All');
    expect(output('add')).toBe('studio,live');
    await filter('Release Year', '1998');
    expect(output('add')).toBe('studio');
    await click('Clear Filters');
    expect(output('add')).toBe('studio');
    await act(async () =>
      root.render(
        <IntlProvider locale="en">
          <CuratedCollectionDetails kind="tv" id="series" />
        </IntlProvider>
      )
    );
    expect(document.querySelector('.music-collection-filter-row')).toBeNull();
    expect(document.querySelector('.music-collection-action-row')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
