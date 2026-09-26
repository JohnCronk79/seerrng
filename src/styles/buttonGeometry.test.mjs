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

test('shared controls, filters, and badges use 16px without dropdown height overrides', () => {
  for (const token of [
    '--compact-control-height',
    '--filter-control-height',
    '--action-control-height',
    '--poster-control-height',
  ]) {
    assert.ok(css.includes(`${token}: 1rem;`), token);
  }
  assert.match(css, /\.compact-control:is\(button, a\)\s*\{/);
  assert.doesNotMatch(css, /\.app-button\[aria-haspopup\]/);
  assert.doesNotMatch(
    css,
    /\.app-button\.app-button-playback\[aria-haspopup\]/
  );
  assert.match(
    css,
    /\.app-badge\s*\{[^}]*height: var\(--compact-control-height\);/s
  );
});

test('styled dropdown menu rows use the shared 16px height', () => {
  assert.match(css, /--filter-option-height: var\(--filter-control-height\);/);
  for (const selector of ['.app-dropdown-item', '.issue-options-menu-action']) {
    const start = css.lastIndexOf('\n  ' + selector + ' {');
    assert.ok(start > -1, selector);
    const rule = css.slice(start, css.indexOf('}', start));
    assert.ok(rule.includes('height: var(--action-control-height);'), selector);
  }
  for (const selector of [
    '.request-listbox-option',
    '.app-filter-select-option',
  ]) {
    const start = css.lastIndexOf('\n  ' + selector + ' {');
    assert.ok(start > -1, selector);
    const rule = css.slice(start, css.indexOf('}', start));
    assert.ok(rule.includes('height: var(--filter-option-height);'), selector);
  }
  assert.match(
    css,
    /\.react-select-container \.react-select__option\s*\{[^}]*height: var\(--filter-control-height\) !important;/s
  );
  assert.match(css, /--profile-menu-row-height: 1\.25rem;/);
  assert.match(
    css,
    /\.user-dropdown-action\s*\{[^}]*height: var\(--profile-menu-row-height\);/s
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

test('unselected controls use Manage opacity while selected filters stay solid', () => {
  const rule = (selector) => {
    const start = css.indexOf(`\n  ${selector} {`);
    const combinedStart = css.indexOf(`\n  ${selector},`);
    const matchStart = start >= 0 ? start : combinedStart;
    if (matchStart < 0) {
      return '';
    }
    const open = css.indexOf('{', matchStart);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  for (const selector of [
    '.app-button-manage',
    '.app-button-bulk-request',
    '.app-button-playback',
    '.app-button-ghost',
  ]) {
    const declaration = rule(selector);
    assert.match(declaration, /bg-[\w-]+\/35/, selector);
    assert.match(declaration, /hover:bg-[\w-]+\/55/, selector);
    assert.match(declaration, /active:bg-[\w-]+\/70/, selector);
  }

  for (const selector of [
    '.app-filter-button-idle',
    '.discover-filter-control',
  ]) {
    assert.match(rule(selector), /\/ 0\.35\)/, selector);
    assert.match(rule(`${selector}:hover`), /\/ 0\.55\)/, selector);
    assert.match(rule(`${selector}:active`), /\/ 0\.7\)/, selector);
  }

  assert.match(rule('.app-filter-button-active'), /bg-indigo-500\b/);
  assert.match(rule('.watched-status-badge'), /bg-black\/35/);
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
