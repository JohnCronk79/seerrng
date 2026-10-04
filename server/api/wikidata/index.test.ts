import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import WikidataAPI from '@server/api/wikidata';

describe('WikidataAPI response normalization', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('bounds and structurally validates provider bindings', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      results: {
        bindings: [
          null,
          { canonicalTitle: { value: {} } },
          ...Array.from({ length: 40 }, (_, index) => ({
            canonicalTitle: { value: ` Book ${index} ` },
            authorLabel: { value: ` Author ${index} ` },
            isbn13: { value: index === 0 ? '9780306406157' : 'invalid' },
          })),
        ],
      },
    }));

    const result = await new WikidataAPI().getCanonicalBookTerms({
      title: 'Book',
    });

    assert.strictEqual(result.length, 23);
    assert.deepStrictEqual(result[0], {
      title: 'Book 0',
      authorName: 'Author 0',
      isbn13: '9780306406157',
    });
    assert.strictEqual(result.at(-1)?.title, 'Book 22');
  });

  it('returns no terms for malformed top-level results', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({ results: null }));

    assert.deepStrictEqual(
      await new WikidataAPI().getCanonicalBookTerms({ title: 'Book' }),
      []
    );
  });
});
