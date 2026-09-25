import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

test('disclosure controls reuse Manage colors including hover and active states', () => {
  assert.match(
    css,
    /\.app-button-manage,\s*\.detail-disclosure-control\s*\{\s*@apply border-violet-500\/90 bg-violet-950\/35 hover:bg-violet-900\/55 active:bg-violet-900\/70 text-violet-300/
  );
  const geometry = css.match(
    /\.detail-disclosure-control\s*\{\s*@apply inline-flex[^}]+\}/
  )?.[0];
  assert.ok(geometry);
  assert.match(geometry, /height: var\(--action-control-height\)/);
  assert.doesNotMatch(geometry, /background-color:|border-color:|\bcolor:/);
  assert.doesNotMatch(css, /\.detail-disclosure-control:hover\s*\{/);
});

test('pin state and keyboard focus remain distinct in the purple palette', () => {
  assert.match(
    css,
    /\.detail-disclosure-pin-active\s*\{\s*@apply bg-violet-500\/35 text-white;/
  );
  assert.match(
    css,
    /\.detail-disclosure-control:focus-within\s*\{\s*@apply border-violet-300;/
  );
  assert.match(
    css,
    /\.detail-disclosure-button\s*\{[^}]*focus:ring-violet-500/
  );
});
