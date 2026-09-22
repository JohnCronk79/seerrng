import { Transition } from '@headlessui/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import DiscographyRequestModal from './DiscographyRequestModal';

vi.mock('@app/components/Common/Modal', () => ({
  default: (props: {
    children: React.ReactNode;
    hideActions: boolean;
    onOk?: unknown;
    onCancel?: unknown;
  }) => (
    <Transition.Child
      as="div"
      data-hidden-actions={String(props.hideActions)}
      data-submit={String(!!props.onOk)}
      data-dismiss={String(!!props.onCancel)}
    >
      {props.children}
    </Transition.Child>
  ),
}));
vi.mock('@app/components/CollectionDetails/CuratedCollectionDetails', () => ({
  default: (props: { id: string; kind: string; discographyArtist: string }) => (
    <div data-artist={props.id} data-kind={props.kind}>
      {props.discographyArtist}
    </div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
it('uses the collection view without submission controls and retains dismissal', () => {
  vi.stubGlobal('React', React);
  const html = renderToStaticMarkup(
    <DiscographyRequestModal
      show
      artistId="artist-id"
      artistName="Madonna"
      onCancel={() => {}}
    />
  );
  expect(html).toContain('data-hidden-actions="true"');
  expect(html).toContain('data-submit="false"');
  expect(html).toContain('data-dismiss="true"');
  expect(html).toContain('data-artist="artist-id"');
  expect(html).toContain('data-kind="music"');
  expect(html).toContain('Madonna');
});
it('does not mount or fetch the catalogue while closed', () => {
  vi.stubGlobal('React', React);
  expect(
    renderToStaticMarkup(
      <DiscographyRequestModal
        show={false}
        artistId="artist-id"
        artistName="Madonna"
        onCancel={() => {}}
      />
    )
  ).toBe('');
});
