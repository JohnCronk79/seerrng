import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const requestRule = css.match(/\.format-request-control\s*\{([^}]+)\}/)?.[1];

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
  assert.match(css, /\.issue-view-action\s*\{[^}]*text-\[11px\]/s);
  assert.match(css, /\.button-sm\s*\{[^}]*text-xs/s);
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
