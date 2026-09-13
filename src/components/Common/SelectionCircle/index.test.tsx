import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';
import SelectionCircle from './index';

describe('SelectionCircle', () => {
  it('exposes a mixed pressed state for partial selection', () => {
    const markup = renderToStaticMarkup(
      <SelectionCircle
        selected={false}
        partial
        label="Partially selected season"
        onClick={() => undefined}
      />
    );

    assert.match(markup, /aria-pressed="mixed"/);
    assert.match(markup, /data-partial="true"/);
  });

  it('retains the normal pressed state for full selection', () => {
    const markup = renderToStaticMarkup(
      <SelectionCircle
        selected
        label="Fully selected season"
        onClick={() => undefined}
      />
    );

    assert.match(markup, /aria-pressed="true"/);
    assert.doesNotMatch(markup, /data-partial/);
  });
});
