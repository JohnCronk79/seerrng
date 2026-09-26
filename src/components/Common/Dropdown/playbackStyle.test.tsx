import ButtonWithDropdown from '@app/components/Common/ButtonWithDropdown';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dropdown from './index';

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it('keeps unavailable device playback disabled with shared playback styling and help', () => {
  const html = renderToStaticMarkup(
    <Dropdown
      buttonType="playback"
      buttonSize="sm"
      text="Play on Device"
      disabledReason="No devices available"
    />
  );
  expect(html).toContain(
    'app-button app-button-playback playback-dropdown-trigger button-sm'
  );
  expect(html).toContain('disabled=""');
  expect(html).toContain('data-disabled-reason="No devices available"');
  expect(html).not.toContain('disabled:brightness-50');
  expect(html).not.toContain('leading-5');
});

it('keeps the available playback dropdown enabled and compact', () => {
  const html = renderToStaticMarkup(
    <Dropdown buttonType="playback" buttonSize="sm" text="Play on Device">
      <Dropdown.Item buttonType="playback">Living room</Dropdown.Item>
    </Dropdown>
  );
  expect(html).toContain('playback-dropdown-trigger button-sm');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).not.toContain('disabled=""');
});

it('uses the shared button treatment for other dropdown triggers', () => {
  const html = renderToStaticMarkup(
    <Dropdown buttonType="primary" text="Other dropdown" />
  );
  expect(html).not.toContain('playback-dropdown-trigger');
  expect(html).toContain('app-button app-button-primary button-md');
});

it('gives both halves of a split playback button the shared styling', () => {
  const html = renderToStaticMarkup(
    <ButtonWithDropdown buttonType="playback" text="Play on Plex">
      <ButtonWithDropdown.Item buttonType="playback">
        Play in 4K
      </ButtonWithDropdown.Item>
    </ButtonWithDropdown>
  );
  expect(html.match(/app-button-playback/g)).toHaveLength(2);
  expect(html).toContain('aria-haspopup="menu"');
});
