import type { ParsedUrlQuery } from 'querystring';

export const parseQueryFromPath = (path: string): ParsedUrlQuery => {
  const queryString = path.split('?', 2)[1]?.split('#', 1)[0];

  if (!queryString) {
    return {};
  }

  const queryValues = new Map<string, string | string[]>();
  const searchParams = new URLSearchParams(queryString);

  searchParams.forEach((value, key) => {
    const currentValue = queryValues.get(key);

    if (currentValue === undefined) {
      queryValues.set(key, value);
    } else if (Array.isArray(currentValue)) {
      queryValues.set(key, [...currentValue, value]);
    } else {
      queryValues.set(key, [currentValue, value]);
    }
  });

  return Object.fromEntries(queryValues) as ParsedUrlQuery;
};
