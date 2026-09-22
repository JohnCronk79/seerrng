import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import MusicRatings from './MusicRatings';

vi.mock('@app/assets/musicbrainz.svg', () => ({ default: () => <svg /> }));
vi.mock('@app/assets/services/lidarr.svg', () => ({ default: () => <svg /> }));
vi.mock('@app/components/Common/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
beforeEach(() => vi.stubGlobal('React', React));
it('renders distinct scales and safe source links using the shared rating classes', () => {
  const html = renderToStaticMarkup(
    <IntlProvider locale="en">
      <MusicRatings
        ratings={[
          {
            source: 'theaudiodb',
            score: 9,
            scale: 10,
            votes: 2,
            url: 'https://www.theaudiodb.com/album/2109828',
          },
          {
            source: 'discogs',
            score: 4.5,
            scale: 5,
            votes: 15,
            url: 'https://www.discogs.com/release/249504',
          },
        ]}
      />
    </IntlProvider>
  );
  expect(html).toContain('MusicBrainz: no rating available.');
  expect(html).toContain('TheAudioDB: 9/10 from 2 votes.');
  expect(html).toContain('Discogs: 4.5/5 from 15 votes.');
  expect(html).toContain('master entry’s main release');
  expect(html).toContain('class="media-rating-value">4.5/5');
  expect(html).toContain('href="https://www.discogs.com/release/249504"');
});
