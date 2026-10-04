export const MAX_BULK_CATALOG_ITEMS = 2_000;
export const MAX_BULK_CATALOG_OFFSET = 100_000;

type OffsetCatalogPage<T> = {
  items: T[];
  limit?: unknown;
  nextOffset?: unknown;
  totalItems?: unknown;
};

type NumberedCatalogPage<T> = {
  items: T[];
  totalPages?: unknown;
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value > 0;

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
};

export const loadOffsetCatalog = async <T>({
  initialOffset = 0,
  loadPage,
  maxItems = MAX_BULK_CATALOG_ITEMS,
  pageSize,
  signal,
}: {
  initialOffset?: number;
  loadPage: (
    offset: number,
    limit: number,
    signal: AbortSignal
  ) => Promise<OffsetCatalogPage<T>>;
  maxItems?: number;
  pageSize: number;
  signal: AbortSignal;
}): Promise<{
  items: T[];
  nextOffset: number;
  totalItems: number;
}> => {
  if (
    !isNonNegativeInteger(initialOffset) ||
    initialOffset > MAX_BULK_CATALOG_OFFSET ||
    !isPositiveInteger(pageSize) ||
    !isPositiveInteger(maxItems)
  ) {
    throw new RangeError('Invalid offset catalog pagination options.');
  }

  const items: T[] = [];
  let offset = initialOffset;
  let totalItems = initialOffset;
  const maxRequests = Math.ceil(maxItems / pageSize);

  for (let request = 0; request < maxRequests; request += 1) {
    throwIfAborted(signal);
    const requestedLimit = Math.min(pageSize, maxItems - items.length);
    const response = await loadPage(offset, requestedLimit, signal);
    throwIfAborted(signal);

    const pageItems = Array.isArray(response.items)
      ? response.items.slice(0, requestedLimit)
      : [];
    items.push(...pageItems);

    const responseTotal = isNonNegativeInteger(response.totalItems)
      ? response.totalItems
      : offset + pageItems.length;
    totalItems = Math.max(totalItems, responseTotal);

    const fallbackStep = isPositiveInteger(response.limit)
      ? Math.min(response.limit, requestedLimit)
      : requestedLimit;
    const candidateOffset =
      response.nextOffset === undefined
        ? offset + fallbackStep
        : response.nextOffset;

    if (
      !isPositiveInteger(candidateOffset) ||
      candidateOffset <= offset ||
      candidateOffset > MAX_BULK_CATALOG_OFFSET
    ) {
      break;
    }

    offset = candidateOffset;
    if (offset >= totalItems || items.length >= maxItems) {
      break;
    }
  }

  return { items, nextOffset: offset, totalItems };
};

export const loadNumberedCatalog = async <T>({
  loadPage,
  maxItems = MAX_BULK_CATALOG_ITEMS,
  pageSize,
  signal,
}: {
  loadPage: (
    page: number,
    pageSize: number,
    signal: AbortSignal
  ) => Promise<NumberedCatalogPage<T>>;
  maxItems?: number;
  pageSize: number;
  signal: AbortSignal;
}): Promise<T[]> => {
  if (!isPositiveInteger(pageSize) || !isPositiveInteger(maxItems)) {
    throw new RangeError('Invalid numbered catalog pagination options.');
  }

  const items: T[] = [];
  const maxPages = Math.ceil(maxItems / pageSize);
  let lastPage = 1;

  for (let page = 1; page <= lastPage && page <= maxPages; page += 1) {
    throwIfAborted(signal);
    const response = await loadPage(page, pageSize, signal);
    throwIfAborted(signal);

    const remaining = maxItems - items.length;
    const pageItems = Array.isArray(response.items)
      ? response.items.slice(0, remaining)
      : [];
    items.push(...pageItems);

    if (isPositiveInteger(response.totalPages)) {
      lastPage = Math.min(response.totalPages, maxPages);
    } else {
      lastPage = page;
    }

    if (items.length >= maxItems || pageItems.length === 0) {
      break;
    }
  }

  return items;
};
