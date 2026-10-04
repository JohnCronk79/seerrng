import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasMediaSliderResults, shouldShowMoreSliderCard } from './mediaSlider';

describe('media slider snapshots', () => {
  it('does not treat cached empty pages as usable results', () => {
    assert.equal(hasMediaSliderResults(undefined), false);
    assert.equal(hasMediaSliderResults([{ results: [] }]), false);
    assert.equal(
      hasMediaSliderResults([{ results: [] }, { results: [{ id: 1 }] }]),
      true
    );
  });
});

describe('media slider pagination', () => {
  it('shows the navigation card for a cached first page with more results', () => {
    assert.equal(
      shouldShowMoreSliderCard({
        hasLink: true,
        loadedTitleCount: 20,
        totalResults: 100,
      }),
      true
    );
  });

  it('does not show the navigation card when the first page is complete', () => {
    assert.equal(
      shouldShowMoreSliderCard({
        hasLink: true,
        loadedTitleCount: 20,
        totalResults: 20,
      }),
      false
    );
  });

  it('requires a destination even when more results exist', () => {
    assert.equal(
      shouldShowMoreSliderCard({
        hasLink: false,
        loadedTitleCount: 20,
        totalResults: 100,
      }),
      false
    );
  });
});
