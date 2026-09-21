import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import Button from './index';

beforeEach(() => vi.stubGlobal('React', React));

it('renders one decorative shared X for a cancel action without leaking its prop', () => {
  const html = renderToStaticMarkup(
    <Button buttonIcon="cancel" buttonType="success">
      Cancel
    </Button>
  );
  expect((html.match(/<svg/g) ?? []).length).toBe(1);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('app-button-success');
  expect(html).not.toContain('buttonIcon');
});

it('does not add an icon to ordinary buttons', () => {
  expect(renderToStaticMarkup(<Button>Save</Button>)).not.toContain('<svg');
});

it('renders one shared trash icon for destructive confirmations', () => {
  const html = renderToStaticMarkup(
    <Button buttonIcon="delete" buttonType="danger">
      Delete
    </Button>
  );
  expect((html.match(/<svg/g) ?? []).length).toBe(1);
  expect(html).toContain('app-button-danger');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('buttonIcon');
});

it('renders the browse magnifying glass through the same shared icon styling', () => {
  const html = renderToStaticMarkup(
    <Button buttonIcon="browse">Browse More</Button>
  );
  expect((html.match(/<svg/g) ?? []).length).toBe(1);
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('buttonIcon');
});
