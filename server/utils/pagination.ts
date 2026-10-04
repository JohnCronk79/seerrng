const parseScalarNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }

  return Number.NaN;
};

export const MAX_PAGINATION_OFFSET = 100_000;

export const parsePositiveInt = (
  value: unknown,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const parsed = parseScalarNumber(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
};

export const parseNonNegativeInt = (
  value: unknown,
  fallback = 0,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const parsed = parseScalarNumber(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

export const parseOptionalPositiveInt = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = parseScalarNumber(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.min(parsed, max);
};

export const parsePageParams = (
  query: { take?: unknown; skip?: unknown },
  defaults: { take: number; maxTake?: number; maxSkip?: number }
) => {
  const pageSize = parsePositiveInt(
    query.take,
    defaults.take,
    defaults.maxTake ?? 100
  );
  const boundedSkip = parseNonNegativeInt(
    query.skip,
    0,
    defaults.maxSkip ?? MAX_PAGINATION_OFFSET
  );

  return { pageSize, skip: boundedSkip };
};
