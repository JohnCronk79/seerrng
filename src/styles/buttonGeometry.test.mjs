import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const requestRule = css.match(/\.format-request-control\s*\{([^}]+)\}/)?.[1];
const component = (path) =>
  readFileSync(new URL(`../components/${path}`, import.meta.url), 'utf8');

test('segmented Request uses the shared action height, not a fixed size', () => {
  assert.ok(requestRule);
  for (const property of ['height', 'min-height', 'max-height']) {
    assert.ok(
      requestRule.includes(`${property}: var(--action-control-height);`)
    );
  }
  assert.match(requestRule, /box-sizing: border-box;/);
  assert.doesNotMatch(requestRule, /\b(?:h|min-h|max-h)-\S+/);
});

test('Request preserves its typography, color and border styling', () => {
  for (const utility of [
    'text-xs',
    'font-medium',
    'text-green-200',
    'border-green-500/80',
    'bg-green-950/35',
    'rounded-md',
    'items-stretch',
  ]) {
    assert.ok(requestRule?.includes(utility));
  }
});

test('action buttons fit a 16px detail row without shrinking their text', () => {
  assert.match(css, /--action-control-height: 1rem;/);
  assert.match(css, /--action-control-padding-x: 9px;/);
  assert.match(css, /--compact-button-padding-x: 7px;/);
  assert.match(
    css,
    /padding-inline: var\(--action-control-padding-x\) !important/
  );
  assert.match(
    css,
    /padding-inline: var\(--compact-button-padding-x\) !important/
  );
  assert.match(
    css,
    /\.issue-action-value\s*\{[^}]*display: flex;[^}]*align-items: center;/s
  );
  assert.match(css, /\.button-sm\s*\{[^}]*text-xs/s);
});

test('icon and label spacing is defined once for shared buttons and filters', () => {
  assert.match(css, /--button-content-gap: 0\.375rem;/);
  for (const selector of [
    '.format-request-label',
    '.app-button',
    '.app-button > span',
    '.detail-disclosure-button',
    '.app-filter-button',
    '.app-filter-select-trigger',
    '.discover-filter-control-label',
    '.request-listbox-button',
  ]) {
    const start = css.lastIndexOf('\n  ' + selector + ' {');
    assert.ok(start > -1, selector);
    const rule = css.slice(start, css.indexOf('}', start));
    assert.ok(
      rule.includes('column-gap: var(--button-content-gap);'),
      selector
    );
  }
});

test('form input and dropdown control heights remain 20px', () => {
  assert.match(css, /--compact-control-height: 1\.25rem;/);
  assert.match(
    css,
    /\.compact-control:is\(button, a\):not\(\[aria-haspopup\]\):not\(\[role='combobox'\]\)/
  );
  assert.match(
    css,
    /\.app-button\[aria-haspopup\]:not\(\.playback-dropdown-trigger\),[\s\S]*?height: var\(--compact-control-height\) !important;/
  );
});

test('poster badges keep the shared compact poster geometry', () => {
  assert.match(css, /--poster-control-height: 1rem;/);
  assert.match(
    css,
    /\.poster-control \.watched-status-logo\s*\{[^}]*width: auto;[^}]*height: var\(--poster-control-content-height\);/s
  );
  for (const path of [
    'Common/MediaTypeBadge/index.tsx',
    'Common/BookFormatBadge/index.tsx',
    'Common/StatusBadgeMini/index.tsx',
    'Association/AssociationBadge.tsx',
  ]) {
    assert.match(component(path), /poster-control(?:-icon)?/, path);
  }
});

test('poster availability and watched badges share a translucent poster surface', () => {
  assert.match(
    css,
    /\.poster-control\s*\{[^}]*background-color: transparent;/s
  );
  assert.match(
    css,
    /\.poster-control\.poster-control-available\s*\{[^}]*bg-green-950\/35/s
  );
  assert.doesNotMatch(
    css.match(/\.watched-status-badge\s*\{([^}]+)\}/)?.[1] ?? '',
    /\bbg-black(?!\/35)\b/
  );
  assert.match(
    css.match(/\.watched-status-badge\s*\{([^}]+)\}/)?.[1] ?? '',
    /bg-black\/35/
  );
  assert.match(
    component('Common/WatchedBadge/index.tsx'),
    /poster-control watched-status-badge/
  );
  assert.match(
    component('Common/StatusBadgeMini/index.tsx'),
    /poster-control-available/
  );
  for (const path of [
    'Common/MediaTypeBadge/index.tsx',
    'Common/BookFormatBadge/index.tsx',
    'Association/AssociationBadge.tsx',
  ]) {
    assert.match(
      component(path),
      /poster-control-(?:type|book-format|association)/
    );
  }
});

test('segmented filters keep the outward focus ring', () => {
  for (const path of [
    'Blocklist/index.tsx',
    'Discover/BookFormatTabs/index.tsx',
    'Discover/DiscoverMediaTabs.tsx',
    'Discover/MediaFilterOption.tsx',
    'IssueList/index.tsx',
    'Requests/index.tsx',
    'Search/index.tsx',
  ]) {
    const source = component(path);
    assert.match(source, /app-filter-segment-focus/, path);
    assert.doesNotMatch(source, /focus:ring-inset/, path);
  }
});
