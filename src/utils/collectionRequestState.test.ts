import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCollectionPartRequestPresentation,
  getCoveredCollectionPartIds,
} from './collectionRequestState';

describe('collection request state', () => {
  it('tracks the movie identity instead of the active request identity', () => {
    assert.deepStrictEqual(
      getCoveredCollectionPartIds(
        [
          {
            id: 900,
            mediaInfo: {
              requests: [
                {
                  is4k: false,
                  status: MediaRequestStatus.PENDING,
                },
              ],
            },
          },
        ],
        false
      ),
      [900]
    );
  });

  it('partitions requests and availability by resolution', () => {
    assert.deepStrictEqual(
      getCoveredCollectionPartIds(
        [
          {
            id: 1,
            mediaInfo: {
              status: MediaStatus.AVAILABLE,
              status4k: MediaStatus.UNKNOWN,
            },
          },
          {
            id: 2,
            mediaInfo: {
              requests: [
                {
                  is4k: true,
                  status: MediaRequestStatus.PENDING,
                },
                {
                  is4k: false,
                  status: MediaRequestStatus.FAILED,
                },
              ],
            },
          },
        ],
        false
      ),
      [1]
    );
    assert.deepStrictEqual(
      getCoveredCollectionPartIds(
        [
          {
            id: 1,
            mediaInfo: {
              status: MediaStatus.AVAILABLE,
              status4k: MediaStatus.UNKNOWN,
            },
          },
          {
            id: 2,
            mediaInfo: {
              requests: [
                {
                  is4k: true,
                  status: MediaRequestStatus.PENDING,
                },
              ],
            },
          },
        ],
        true
      ),
      [2]
    );
  });

  it('presents ready and available collection status with distinct states', () => {
    assert.strictEqual(
      getCollectionPartRequestPresentation(
        { id: 1, mediaInfo: { status: MediaStatus.UNKNOWN } },
        false
      ),
      'ready'
    );
    assert.strictEqual(
      getCollectionPartRequestPresentation(
        { id: 2, mediaInfo: { status: MediaStatus.AVAILABLE } },
        false
      ),
      'available'
    );
  });

  it('keeps active requests and blocklisted members out of the ready state', () => {
    assert.strictEqual(
      getCollectionPartRequestPresentation(
        {
          id: 1,
          mediaInfo: {
            requests: [{ is4k: true, status: MediaRequestStatus.PENDING }],
          },
        },
        true
      ),
      'requested'
    );
    assert.strictEqual(
      getCollectionPartRequestPresentation(
        { id: 2, mediaInfo: { status4k: MediaStatus.BLOCKLISTED } },
        true
      ),
      'blocklisted'
    );
  });
});
