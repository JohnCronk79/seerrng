import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getSearchActivitySnapshot,
  setSearchActivity,
} from './useSearchActivity';

afterEach(() => {
  setSearchActivity(false);
  setSearchActivity(false, 'request-status');
  setSearchActivity(false, 'issues');
});

describe('search activity state', () => {
  it('tracks repeated loading transitions until the request finishes', () => {
    assert.strictEqual(getSearchActivitySnapshot(), false);

    setSearchActivity(true);
    setSearchActivity(true);
    assert.strictEqual(getSearchActivitySnapshot(), true);

    setSearchActivity(false);
    assert.strictEqual(getSearchActivitySnapshot(), false);
  });
});

it('keeps search activity visible until every active source finishes', () => {
  setSearchActivity(true, 'request-status');
  setSearchActivity(true, 'issues');
  assert.strictEqual(getSearchActivitySnapshot(), true);

  setSearchActivity(false, 'request-status');
  assert.strictEqual(getSearchActivitySnapshot(), true);

  setSearchActivity(false, 'issues');
  assert.strictEqual(getSearchActivitySnapshot(), false);
});
