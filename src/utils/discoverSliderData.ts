const MAX_WATCH_PROVIDER_IDS = 100;
const MAX_WATCH_PROVIDER_ID = 1_000_000_000;

export const parseWatchProviderIds = (value: string | undefined): number[] => {
  if (!value) {
    return [];
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of value.split('|')) {
    if (!/^[1-9]\d*$/.test(part)) {
      continue;
    }
    const id = Number(part);
    if (
      !Number.isSafeInteger(id) ||
      id > MAX_WATCH_PROVIDER_ID ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_WATCH_PROVIDER_IDS) {
      break;
    }
  }

  return ids;
};
