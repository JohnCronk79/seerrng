import LazyLibrarianAPI from '@server/api/lazylibrarian';
import { getRepository } from '@server/datasource';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import logger from '@server/logger';
import { mapLazyLibrarianMagazineDetails } from '@server/models/Magazine';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';

const magazineRoutes = Router();

magazineRoutes.get('/:title', async (req, res, next) => {
  const parsed = parseBoundedString(req.params.title, {
    fieldName: 'Magazine title',
    maxLength: 256,
  });
  if ('error' in parsed) {
    return res
      .status(404)
      .json({ status: 404, message: 'Magazine not found.' });
  }
  const title = parsed.value.trim().replace(/\s+/g, ' ');
  const normalizedTitle = normalizeMagazineTitle(title);
  if (!normalizedTitle) {
    return res
      .status(404)
      .json({ status: 404, message: 'Magazine not found.' });
  }

  try {
    const identifier = await getRepository(MediaIdentifier).findOne({
      where: {
        provider: MediaIdentifierProvider.LAZYLIBRARIAN,
        value: normalizedTitle,
      },
      relations: { media: true },
      relationLoadStrategy: 'query',
    });
    const media = identifier?.media
      ? (await hydrateMediaSummaryRelations([identifier.media], req.user))[0]
      : undefined;
    const settings = getExternalRuntimeConfig();
    const service =
      settings.lazylibrarian.find(
        (candidate) => candidate.id === media?.serviceId
      ) ?? settings.lazylibrarian.find((candidate) => candidate.isDefault);

    let magazine = { title };
    let issues: Awaited<ReturnType<LazyLibrarianAPI['getIssues']>>['issues'] =
      [];
    if (service) {
      const api = new LazyLibrarianAPI({
        url: LazyLibrarianAPI.buildUrl(service),
        apiKey: service.apiKey,
      });
      const detail = await api.getIssues(media?.externalServiceSlug ?? title);
      magazine = detail.magazine ?? { title };
      issues = detail.issues;
    }

    return res
      .status(200)
      .json(
        filterEntityResponse(
          mapLazyLibrarianMagazineDetails(magazine, issues, media),
          req.user
        )
      );
  } catch (error) {
    logger.error('Failed to retrieve magazine details', {
      label: 'Magazine',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return next({
      status: 503,
      message: 'Unable to retrieve magazine details.',
    });
  }
});

export default magazineRoutes;
