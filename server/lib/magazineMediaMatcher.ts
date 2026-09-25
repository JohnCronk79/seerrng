import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import type { User } from '@server/entity/User';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { In } from 'typeorm';

export const findMagazineMediaByTitles = async (
  titles: string[],
  user?: User
): Promise<Map<string, Media>> => {
  const normalizedTitles = [
    ...new Set(titles.map(normalizeMagazineTitle).filter(Boolean)),
  ];
  if (normalizedTitles.length === 0) {
    return new Map();
  }

  const identifiers = await getRepository(MediaIdentifier).find({
    where: {
      provider: MediaIdentifierProvider.LAZYLIBRARIAN,
      value: In(normalizedTitles),
    },
    relations: { media: true },
    relationLoadStrategy: 'query',
  });
  const linked = identifiers.filter(
    (identifier) => identifier.media?.mediaType === MediaType.MAGAZINE
  );
  const hydrated = await hydrateMediaSummaryRelations(
    linked.map((identifier) => identifier.media),
    user
  );
  const hydratedById = new Map(hydrated.map((media) => [media.id, media]));

  return new Map(
    linked.flatMap((identifier) => {
      const media = hydratedById.get(identifier.media.id);
      return media
        ? [[normalizeMagazineTitle(identifier.value), media] as const]
        : [];
    })
  );
};
