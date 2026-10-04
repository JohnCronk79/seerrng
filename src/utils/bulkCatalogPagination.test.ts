import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_BULK_CATALOG_ITEMS,
  loadNumberedCatalog,
  loadOffsetCatalog,
} from './bulkCatalogPagination';

describe('bulk catalog pagination', () => {
  it('bounds offset pagination even when the provider advertises a huge catalog', async () => {
    const controller = new AbortController();
    const offsets: number[] = [];
    const result = await loadOffsetCatalog({
      pageSize: 100,
      signal: controller.signal,
      loadPage: async (offset, limit) => {
        offsets.push(offset);
        return {
          items: Array.from({ length: limit }, (_, index) => offset + index),
          limit,
          nextOffset: offset + limit,
          totalItems: 1_000_000,
        };
      },
    });

    assert.equal(result.items.length, MAX_BULK_CATALOG_ITEMS);
    assert.equal(offsets.length, 20);
    assert.equal(result.nextOffset, MAX_BULK_CATALOG_ITEMS);
    assert.equal(result.totalItems, 1_000_000);
  });

  it('stops offset pagination when the provider does not make progress', async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await loadOffsetCatalog({
      pageSize: 100,
      signal: controller.signal,
      loadPage: async (offset) => {
        calls += 1;
        return {
          items: [offset],
          nextOffset: offset,
          totalItems: 10_000,
        };
      },
    });

    assert.equal(calls, 1);
    assert.deepStrictEqual(result.items, [0]);
  });

  it('aborts between offset pages instead of continuing background requests', async () => {
    const controller = new AbortController();
    let calls = 0;

    await assert.rejects(
      loadOffsetCatalog({
        pageSize: 100,
        signal: controller.signal,
        loadPage: async (offset, limit) => {
          calls += 1;
          controller.abort();
          return {
            items: [offset],
            nextOffset: offset + limit,
            totalItems: 10_000,
          };
        },
      }),
      { name: 'AbortError' }
    );
    assert.equal(calls, 1);
  });

  it('bounds numbered pagination from untrusted total page counts', async () => {
    const controller = new AbortController();
    let calls = 0;
    const items = await loadNumberedCatalog({
      pageSize: 50,
      signal: controller.signal,
      loadPage: async (page, pageSize) => {
        calls += 1;
        return {
          items: Array.from(
            { length: pageSize },
            (_, index) => (page - 1) * pageSize + index
          ),
          totalPages: Number.MAX_SAFE_INTEGER,
        };
      },
    });

    assert.equal(calls, 40);
    assert.equal(items.length, MAX_BULK_CATALOG_ITEMS);
  });
});
