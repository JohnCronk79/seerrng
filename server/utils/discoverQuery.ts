const extraEncodes: [RegExp, string][] = [
  [/\(/g, '%28'],
  [/\)/g, '%29'],
  [/!/g, '%21'],
  [/\*/g, '%2A'],
];

export const encodeURIExtraParams = (string: string): string => {
  let finalString = encodeURIComponent(string);

  extraEncodes.forEach((encode) => {
    finalString = finalString.replace(encode[0], encode[1]);
  });

  return finalString;
};

const getQueryParamValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => getQueryParamValue(item))
      .find((item): item is string => item !== undefined);
  }

  const stringValue = String(value);

  return stringValue ? stringValue : undefined;
};

export const buildDiscoverQueryString = (
  params: Record<string, unknown>
): string =>
  Object.keys(params)
    .flatMap((paramKey) => {
      const paramValue = getQueryParamValue(params[paramKey]);

      return paramValue
        ? [`${paramKey}=${encodeURIExtraParams(paramValue)}`]
        : [];
    })
    .join('&');

export const appendDiscoverQueryString = (
  params: Record<string, unknown>,
  extraQueryString?: string
): string => {
  const queryParts = [buildDiscoverQueryString(params)];

  if (extraQueryString) {
    queryParts.push(extraQueryString);
  }

  return queryParts.filter(Boolean).join('&');
};
