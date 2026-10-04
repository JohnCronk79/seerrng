import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import {
  normalizeExternalBookId,
  normalizeExternalMediaId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { restrictMediaRelationsForUser } from '@server/lib/mediaResponse';

const mediaTypes = new Set<string>(Object.values(MediaType));
const identifierProviders = new Set<string>(
  Object.values(MediaIdentifierProvider)
);
export const ENTITY_RESPONSE_MAX_DEPTH = 64;
export const ENTITY_RESPONSE_MAX_VALUES = 100_000;

const normalizeResponseRecord = (
  record: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = { ...record };
  const mediaType = normalized.mediaType;
  const provider = normalized.provider;
  const externalProvider = normalized.externalProvider;

  if (typeof normalized.mbId === 'string') {
    normalized.mbId = normalizeMusicBrainzId(normalized.mbId);
  }

  if (
    typeof normalized.externalId === 'string' &&
    typeof mediaType === 'string' &&
    mediaTypes.has(mediaType)
  ) {
    normalized.externalId = normalizeExternalMediaId(
      normalized.externalId,
      mediaType as MediaType,
      typeof externalProvider === 'string' &&
        identifierProviders.has(externalProvider)
        ? (externalProvider as MediaIdentifierProvider)
        : undefined
    );
  }

  if (
    typeof normalized.value === 'string' &&
    typeof provider === 'string' &&
    identifierProviders.has(provider)
  ) {
    normalized.value =
      provider === MediaIdentifierProvider.MUSICBRAINZ
        ? normalizeMusicBrainzId(normalized.value)
        : normalizeExternalBookId(
            normalized.value,
            provider as MediaIdentifierProvider
          );
  }

  return normalized;
};

export const filterEntityResponse = <T>(value: T, user?: User): T => {
  const ancestors = new WeakSet<object>();
  let visitedValues = 0;

  const filter = (current: unknown, depth: number): unknown => {
    if (
      depth > ENTITY_RESPONSE_MAX_DEPTH ||
      visitedValues >= ENTITY_RESPONSE_MAX_VALUES
    ) {
      return undefined;
    }
    visitedValues += 1;

    if (current instanceof User) {
      return current.publicFilter();
    }

    if (current instanceof Media) {
      restrictMediaRelationsForUser(current, user);
    }

    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      current instanceof Date
    ) {
      return current;
    }

    if (ancestors.has(current)) {
      return undefined;
    }
    ancestors.add(current);

    try {
      if (Array.isArray(current)) {
        const filtered: unknown[] = [];
        for (const entry of current) {
          if (visitedValues >= ENTITY_RESPONSE_MAX_VALUES) break;
          filtered.push(filter(entry, depth + 1));
        }
        return filtered;
      }

      const filtered: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(
        normalizeResponseRecord(current as Record<string, unknown>)
      )) {
        if (visitedValues >= ENTITY_RESPONSE_MAX_VALUES) break;
        const filteredValue = filter(nestedValue, depth + 1);
        if (filteredValue !== undefined) {
          filtered[key] = filteredValue;
        }
      }
      return filtered;
    } finally {
      ancestors.delete(current);
    }
  };

  return filter(value, 0) as T;
};
