import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import {
  ENTITY_RESPONSE_MAX_DEPTH,
  ENTITY_RESPONSE_MAX_VALUES,
  filterEntityResponse,
} from './entityResponse';

describe('filterEntityResponse', () => {
  it('projects embedded users to public display identity only', () => {
    const response = filterEntityResponse({
      requestedBy: new User({
        id: 42,
        displayName: 'Visible Name',
        avatar: 'https://example.com/avatar.png',
        email: 'private@example.com',
        permissions: 2 ** 20,
        plexUsername: 'private-provider-user',
        movieQuotaLimit: 3,
        requestCount: 99,
      }),
    });

    assert.deepStrictEqual(response.requestedBy, {
      id: 42,
      displayName: 'Visible Name',
      avatar: 'https://example.com/avatar.png',
    });
  });

  it('canonicalizes nested music and book identifiers at the response boundary', () => {
    const response = filterEntityResponse({
      mediaType: MediaType.MUSIC,
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      externalId: ' 550E8400-E29B-41D4-A716-446655440000 ',
      mbId: ' 550E8400-E29B-41D4-A716-446655440001 ',
      identifiers: [
        {
          provider: MediaIdentifierProvider.MUSICBRAINZ,
          value: ' 550E8400-E29B-41D4-A716-446655440002 ',
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: '/works/OL123W',
        },
      ],
      book: {
        mediaType: MediaType.BOOK,
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
        externalId: '/works/OL456W',
      },
    });

    assert.equal(response.externalId, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(response.mbId, '550e8400-e29b-41d4-a716-446655440001');
    assert.equal(
      response.identifiers[0].value,
      '550e8400-e29b-41d4-a716-446655440002'
    );
    assert.equal(response.identifiers[1].value, 'OL123W');
    assert.equal(response.book.externalId, 'OL456W');
  });

  it('preserves repeated response values while still removing cycles', () => {
    const shared = { id: 7, label: 'shared' };
    const circular: Record<string, unknown> = { id: 8 };
    circular.self = circular;

    const response = filterEntityResponse({
      first: shared,
      second: shared,
      circular,
    });

    assert.deepStrictEqual(response, {
      first: { id: 7, label: 'shared' },
      second: { id: 7, label: 'shared' },
      circular: { id: 8 },
    });
  });

  it('bounds provider-controlled response depth without overflowing the stack', () => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let depth = 0; depth < ENTITY_RESPONSE_MAX_DEPTH * 10; depth += 1) {
      const next: Record<string, unknown> = {};
      current.next = next;
      current = next;
    }

    assert.doesNotThrow(() => filterEntityResponse(root));
    const response = filterEntityResponse(root);
    let retainedDepth = 0;
    let retained: unknown = response;
    while (retained && typeof retained === 'object' && 'next' in retained) {
      retained = (retained as Record<string, unknown>).next;
      retainedDepth += 1;
    }
    assert.equal(retainedDepth, ENTITY_RESPONSE_MAX_DEPTH);
  });

  it('bounds provider-controlled response traversal work', () => {
    const response = filterEntityResponse(
      Array.from({ length: ENTITY_RESPONSE_MAX_VALUES + 100 }, (_, id) => id)
    );

    assert.equal(response.length, ENTITY_RESPONSE_MAX_VALUES - 1);
    assert.equal(response.at(-1), ENTITY_RESPONSE_MAX_VALUES - 2);
  });
});
