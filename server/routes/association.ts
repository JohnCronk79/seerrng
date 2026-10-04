import { getAssociations } from '@server/lib/associations';
import type { AssociationMediaType } from '@server/lib/associations/types';
import {
  isValidMusicBrainzResourceId,
  isValidOpenLibraryResourceId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { extractImageCacheUrls } from '@server/lib/imageCacheUrls';
import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import logger from '@server/logger';
import { parsePositiveInt } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseBoundedString,
  parseOptionalQueryBoolean,
} from '@server/utils/validation';
import type { Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const associationRoutes = Router();
export const ASSOCIATION_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
const associationRateLimit = rateLimit({
  ...ASSOCIATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
});

associationRoutes.use(associationRateLimit);

associationRoutes.use((_req, res, next) => {
  const json = res.json.bind(res);

  res.json = ((body: unknown) => {
    enqueueImageCacheWarm(extractImageCacheUrls(body));

    return json(body);
  }) as Response['json'];

  next();
});

const VALID_MEDIA_TYPES = new Set<AssociationMediaType>([
  'movie',
  'tv',
  'album',
  'artist',
  'book',
]);
const MAX_ASSOCIATION_EXTERNAL_ID_LENGTH = 128;

const parseAssociationMediaType = (
  mediaType: unknown
): AssociationMediaType | undefined =>
  typeof mediaType === 'string' &&
  VALID_MEDIA_TYPES.has(mediaType as AssociationMediaType)
    ? (mediaType as AssociationMediaType)
    : undefined;

const parseAssociationId = (
  mediaType: AssociationMediaType,
  id: unknown
): string | undefined => {
  if (mediaType === 'movie' || mediaType === 'tv') {
    return parsePositiveRouteId(id)?.toString();
  }

  const parsed = parseBoundedString(id, {
    fieldName: 'Association media ID',
    maxLength: MAX_ASSOCIATION_EXTERNAL_ID_LENGTH,
  });

  if ('error' in parsed) {
    return undefined;
  }

  if (mediaType === 'artist' || mediaType === 'album') {
    const normalizedId = normalizeMusicBrainzId(parsed.value);
    return isValidMusicBrainzResourceId(normalizedId)
      ? normalizedId
      : undefined;
  }

  return isValidOpenLibraryResourceId(parsed.value) ? parsed.value : undefined;
};

associationRoutes.get('/:mediaType/:id', async (req, res, next) => {
  const mediaType = parseAssociationMediaType(req.params.mediaType);

  if (!mediaType) {
    return next({
      status: 400,
      message: 'Invalid association media type.',
    });
  }

  const associationId = parseAssociationId(mediaType, req.params.id);
  if (!associationId) {
    return next({
      status: 400,
      message: 'Invalid association media id.',
    });
  }

  const limit =
    req.query.limit === undefined
      ? undefined
      : parsePositiveInt(req.query.limit, 60, 60);
  const includeWeak = parseOptionalQueryBoolean(
    req.query.includeWeak,
    'Include weak associations'
  );
  if ('error' in includeWeak) {
    return next({ status: 400, message: includeWeak.error });
  }

  try {
    const graph = await getAssociations(mediaType, associationId, req.user, {
      includeWeak: includeWeak.value ?? false,
      limit,
    });

    return res.status(200).json(graph);
  } catch (e) {
    logger.debug('Something went wrong retrieving associations', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      mediaType,
      id: associationId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve associations.',
    });
  }
});

export default associationRoutes;
