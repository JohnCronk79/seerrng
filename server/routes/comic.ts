import ComicVineAPI from '@server/api/comicvine';
import { getRepository } from '@server/datasource';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { mapComicVineVolumeDetails } from '@server/models/Comic';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePositiveInt } from '@server/utils/pagination';
import { Router } from 'express';

const comicRoutes = Router();

comicRoutes.get('/:id', async (req, res, next) => {
  const comicVineId = parsePositiveInt(req.params.id, 0);
  if (comicVineId === 0) {
    return res.status(404).json({ status: 404, message: 'Comic not found' });
  }

  const { comicVineApiKey } = getSettings().main;
  if (!comicVineApiKey) {
    return next({
      status: 503,
      message: 'ComicVine is not configured on this server.',
    });
  }

  try {
    const comicVine = new ComicVineAPI(comicVineApiKey);
    const volume = await comicVine.getVolume(comicVineId);
    if (!volume) {
      return res.status(404).json({ status: 404, message: 'Comic not found' });
    }

    const identifier = await getRepository(MediaIdentifier).findOne({
      where: {
        provider: MediaIdentifierProvider.COMICVINE,
        value: String(comicVineId),
      },
      relations: { media: true },
      relationLoadStrategy: 'query',
    });
    const media = identifier?.media
      ? (await hydrateMediaSummaryRelations([identifier.media], req.user))[0]
      : undefined;

    const comicDetails = mapComicVineVolumeDetails(volume, media);

    return res.status(200).json(filterEntityResponse(comicDetails, req.user));
  } catch (e) {
    logger.error('Failed to retrieve comic details', {
      label: 'Comic',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      comicVineId,
    });
    return next({ status: 500, message: 'Unable to retrieve comic details.' });
  }
});

export default comicRoutes;
