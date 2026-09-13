import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  validateRefreshedUiStyleBoundaries,
} = require('./check-refreshed-ui-style-lib.js');

test('accepts shared blue surfaces and semantic card text', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface">
          <section className="refreshed-inset-surface">
            <p className="refreshed-detail-text-muted">Details</p>
          </section>
        </article>
      );
    `,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('rejects visual inline and embedded styles in refreshed components', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface" style={{ backgroundColor: '#111827' }}>
          <style>{'.card { color: gray; }'}</style>
        </article>
      );
    `,
  });
  assert.ok(result.errors.some((error) => error.includes('visual inline')));
  assert.ok(result.errors.some((error) => error.includes('embedded style')));
});

test('rejects neutral text and nested near-black cards inside shared surfaces', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface">
          <p className="text-gray-400">Details</p>
          <div className="rounded-lg border border-gray-700 bg-gray-900">Nested</div>
        </article>
      );
    `,
  });
  assert.ok(result.errors.some((error) => error.includes('neutral gray')));
  assert.ok(result.errors.some((error) => error.includes('nested card')));
});

test('allows data-driven geometry without permitting visual overrides', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = ({ width }) => (
        <article className="refreshed-card-surface">
          <div className="h-2" style={{ width }} />
        </article>
      );
    `,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('requires disclosure buttons to use the shared blue control palette', () => {
  const rejected = validateRefreshedUiStyleBoundaries({
    'src/styles/globals.css': `
      .detail-disclosure-button {
        @apply border-gray-600 bg-gray-900 text-gray-300;
      }
    `,
  });
  assert.ok(rejected.errors.some((error) => error.includes('near-black')));
  assert.ok(
    rejected.errors.some((error) => error.includes('blue control palette'))
  );

  const accepted = validateRefreshedUiStyleBoundaries({
    'src/styles/globals.css': `
      .detail-disclosure-button {
        color: rgb(var(--theme-control-text) / 0.9);
        border-color: rgb(var(--theme-control-border) / 0.7);
        background-color: rgb(var(--theme-control-surface) / 0.28);
      }
    `,
  });
  assert.deepStrictEqual(accepted.errors, []);
});
