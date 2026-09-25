import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import type { User } from '@server/entity/User';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { In } from 'typeorm';

export const findComicMediaByComicVineIds = async (
  comicVineIds: number[],
  user?: User
): Promise<Map<number, Media>> => {
  const values = [...new Set(comicVineIds)].map(String);
  if (!values.length) {
    return new Map();
  }

  const identifiers = await getRepository(MediaIdentifier).find({
    where: {
      provider: MediaIdentifierProvider.COMICVINE,
      value: In(values),
    },
    relations: { media: true },
    relationLoadStrategy: 'query',
  });

  const linked = identifiers.filter(
    (identifier) => identifier.media?.mediaType === MediaType.COMIC
  );
  const media = await hydrateMediaSummaryRelations(
    linked.map((identifier) => identifier.media),
    user
  );
  const mediaById = new Map(media.map((item) => [item.id, item]));

  return new Map(
    linked.flatMap((identifier) => {
      const resolved = mediaById.get(identifier.media.id);
      return resolved ? [[Number(identifier.value), resolved] as const] : [];
    })
  );
};
