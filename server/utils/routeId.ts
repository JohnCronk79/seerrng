import { parseOptionalNonNegativeInteger } from '@server/utils/validation';

const MAX_ROUTE_ID = 1_000_000_000;

export const parseNonNegativeRouteId = (
  id: unknown,
  maxValue = MAX_ROUTE_ID
): number | undefined => {
  const parsedValue =
    typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
  return parseOptionalNonNegativeInteger(parsedValue, maxValue);
};

export const parsePositiveRouteId = (
  id: unknown,
  maxValue = MAX_ROUTE_ID
): number | undefined => {
  const parsed = parseNonNegativeRouteId(id, maxValue);

  return parsed && parsed > 0 ? parsed : undefined;
};
