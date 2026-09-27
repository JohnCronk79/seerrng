import { MediaType } from '@server/constants/media';
import type {
  PlaybackCatalogItem,
  PlaybackCatalogResponse,
} from '@server/models/Playback';

export const isPlaybackQuality4k = (value: unknown): boolean =>
  value === true || value === 'true';

const getCatalogItemsInOrder = (
  catalog: PlaybackCatalogResponse
): PlaybackCatalogItem[] => [
  ...(catalog.rootItem ? [catalog.rootItem] : []),
  ...[...catalog.groups]
    .sort((first, second) => first.index - second.index)
    .flatMap((group) =>
      [...group.items].sort((first, second) => {
        const parentDifference =
          (first.parentIndex ?? group.index) -
          (second.parentIndex ?? group.index);
        return parentDifference || first.index - second.index;
      })
    ),
];

const catalogItemPositionKey = (item: PlaybackCatalogItem): string =>
  `${item.kind}:${item.parentIndex ?? 0}:${item.index}`;

export const resolvePlaybackCatalogItemIds = ({
  mediaType,
  targetCatalog,
  requestedItemIds,
  sourceCatalog,
}: {
  mediaType: MediaType;
  targetCatalog: PlaybackCatalogResponse;
  requestedItemIds: string[];
  sourceCatalog?: PlaybackCatalogResponse;
}): string[] => {
  // A movie has exactly one playable catalog item. Always resolve that item
  // from the current server catalog so a stale browser/rating key cannot turn
  // a valid movie into an empty selection. Client-provided IDs remain unused.
  if (mediaType === MediaType.MOVIE) {
    return targetCatalog.rootItem ? [targetCatalog.rootItem.id] : [];
  }

  const requestedIds = new Set(requestedItemIds);
  const targetItems = getCatalogItemsInOrder(targetCatalog);
  if (requestedIds.size === 0) {
    return targetItems.map((item) => item.id);
  }

  const directSelection = targetItems
    .filter((item) => requestedIds.has(item.id))
    .map((item) => item.id);
  if (directSelection.length === requestedIds.size) {
    return directSelection;
  }
  if (!sourceCatalog) {
    return [];
  }

  const sourceItems = getCatalogItemsInOrder(sourceCatalog);
  const selectedSourceItems = sourceItems.filter((item) =>
    requestedIds.has(item.id)
  );
  if (selectedSourceItems.length !== requestedIds.size) {
    return [];
  }
  const targetByPosition = new Map(
    targetItems.map((item) => [catalogItemPositionKey(item), item.id])
  );
  const translated = selectedSourceItems.map((item) =>
    targetByPosition.get(catalogItemPositionKey(item))
  );
  return translated.every((itemId): itemId is string => !!itemId)
    ? translated
    : [];
};
