import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  validateCurrentBatchContract,
} = require('./check-current-batch-contract-lib.js');

test('reports missing files instead of silently skipping contract checks', () => {
  const errors = validateCurrentBatchContract({});
  assert.ok(errors.some((error) => error.includes('Missing contract input:')));
});

test('reports a button-order regression', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('/index.tsx')
          ? 'buttonType="reportIssue" <ExclamationTriangleIcon /> </Button> buttonType="manage" buttonType="blocklist" buttonSize="sm"'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'detail actions must begin Blocklist, Manage, then Report an Issue'
      )
    )
  );
});

test('reports a shared selection-circle asset regression', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'selector component must use the established solid CheckIcon'
      )
    )
  );
});

test('rejects the defective selector pattern in any component', () => {
  const errors = validateCurrentBatchContract({
    'src/components/UnexpectedSelector/index.tsx':
      '<button aria-pressed={selected}><CheckCircleIcon /></button>',
  });
  assert.ok(
    errors.some((error) =>
      error.includes(
        'interactive selection controls must use SelectionCircle instead of embedding CheckCircleIcon'
      )
    )
  );
});

test('reports an incomplete Books discovery navigation contract', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'Books discovery must preserve the All Books, Books, Audiobooks format order'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'the Book poster-card Request action must navigate to the auto-open Details flow'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'an empty default all-books provider response must surface as a provider failure'
      )
    )
  );
});

test('reports incomplete primary navigation cleanup', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).includes('Layout/Sidebar') ||
        String(key).includes('Layout/MobileMenu')
          ? "href: '/discover/audiobooks' href: '/discover/audiobooks' href: '/requests/status'"
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must contain exactly one Audiobooks entry'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must not contain the removed Request Status entry'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must retain exactly one main Requests entry'
      )
    )
  );
});

test('reports filter-control and reset regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  assert.ok(
    errors.some((error) =>
      error.includes(
        'compact discovery selectors must override the white third-party control surface'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'Clear Filters must restore the default sort order on every filtered page'
      )
    )
  );
});

test('reports poster Associations style drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  assert.ok(
    errors.some((error) =>
      error.includes(
        'the poster Associations action must reuse the shared association button style'
      )
    )
  );
});

test('reports poster availability control drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'poster quality states must use the shared rounded status badge',
    'poster quality states must match the rounded media-type badge silhouette',
    'available poster qualities must place the outlined availability icon after the green quality label',
    'poster overlays must keep primary status on row one, Associations on row two left, and secondary status on row two right',
    'music posters must preserve separate MP3 and FLAC request states',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports persistent detail disclosure pin contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'detail disclosure pins must expose their selected state',
    'detail disclosure pins must use the authenticated per-user settings endpoint',
    'detail disclosure pin settings must expose one read and one write route',
    'the disclosure row must keep the same five-pixel gap above and below',
    'the Subject Tags pin must carry into Music details',
    'refreshed inset cards must use the darker translucent control surface without changing outer cards',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports request-card contrast and Advanced Options contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'request controls must match the dark Destination Server dropdown treatment',
    'request table and details dividers must match the Destination Server value background',
    'root-folder scrolling must begin only after five rows',
    'fresh request forms must open Advanced Options by default',
    'full-size request cards must use the site background gradient',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports Firefox dynamic detail-artwork contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'artwork-backed detail cards must use the stable shared artwork layer',
    'the Firefox artwork fallback must reuse the resolved cached image URL',
    'the dynamic artwork workaround must remain Firefox-specific',
    'Firefox must render expanding detail artwork through a stable background layer',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports recovered visual-contract and evidence-provenance regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'the style standard must preserve the single wrapping Request Status task row',
    'the style standard must keep All Books distinct from Clear Filters',
    'the style standard must keep Approval in the right request-details group',
    'the historical visual audit must not claim current render evidence for post-r3 source',
    'Request Status task summaries must retain the approved single-row order',
    'request forms must render Approval in their details grid',
    'request admission must identify a matching promotable pending request',
    'matching-pending promotion must retain cross-media route coverage',
    'request forms must permit authorized matching-pending promotion',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});
