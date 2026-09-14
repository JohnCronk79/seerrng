import type { ParsedUrlQuery } from 'querystring';

export const parseQueryFromPath = (path: string): ParsedUrlQuery => {
  const queryString = path.split('?', 2)[1]?.split('#', 1)[0];

  if (!queryString) {
    return {};
  }

  const query: ParsedUrlQuery = {};
  const searchParams = new URLSearchParams(queryString);

  searchParams.forEach((value, key) => {
    const currentValue = query[key];

    if (currentValue === undefined) {
      query[key] = value;
    } else if (Array.isArray(currentValue)) {
      query[key] = [...currentValue, value];
    } else {
      query[key] = [currentValue, value];
    }
  });

  return query;
};
