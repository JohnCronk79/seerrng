export const resolveCanonicalPlaybackSelection = <T extends string | number>(
  availableItemIds: T[],
  selectedItemIds: T[]
): T[] => {
  const selected = new Set(selectedItemIds);
  const orderedSelection = availableItemIds.filter((itemId) =>
    selected.has(itemId)
  );

  return orderedSelection.length > 0 ? orderedSelection : [...availableItemIds];
};
