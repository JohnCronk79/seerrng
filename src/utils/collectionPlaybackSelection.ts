interface CollectionPlaybackPart {
  id: number;
  releaseDate?: string;
}

const releaseTime = (releaseDate?: string) => {
  const value = releaseDate ? Date.parse(releaseDate) : Number.NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

export const orderCollectionPartsOldestFirst = <
  T extends CollectionPlaybackPart,
>(
  parts: T[]
): T[] =>
  parts
    .map((part, originalIndex) => ({ part, originalIndex }))
    .sort(
      (first, second) =>
        releaseTime(first.part.releaseDate) -
          releaseTime(second.part.releaseDate) ||
        first.originalIndex - second.originalIndex
    )
    .map(({ part }) => part);

export const reconcileCollectionPlaybackSelection = (
  currentSelection: number[],
  availableMediaIds: number[],
  hasManualSelection: boolean
): number[] => {
  if (!hasManualSelection) {
    return [...availableMediaIds];
  }

  const available = new Set(availableMediaIds);
  return currentSelection.filter((mediaId) => available.has(mediaId));
};
