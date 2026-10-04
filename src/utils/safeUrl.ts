const SAFE_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'plex:',
  'emby:',
  'jellyfin:',
]);

export const hasAsciiControlCharacters = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

export const getSafeHref = (href?: null | string): string | undefined => {
  if (!href) {
    return undefined;
  }

  const trimmedHref = href.trim();

  if (
    !trimmedHref ||
    hasAsciiControlCharacters(trimmedHref) ||
    trimmedHref.includes('\\')
  ) {
    return undefined;
  }

  if (trimmedHref.startsWith('/') && !trimmedHref.startsWith('//')) {
    return trimmedHref;
  }

  if (trimmedHref.startsWith('#')) {
    return trimmedHref;
  }

  try {
    const url = new URL(trimmedHref);

    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) &&
      !url.username &&
      !url.password
      ? trimmedHref
      : undefined;
  } catch {
    return undefined;
  }
};

export const isExternalHref = (href: string): boolean => {
  if (hasAsciiControlCharacters(href) || href.includes('\\')) {
    return false;
  }

  try {
    const url = new URL(href);
    return (
      SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

export const getSafeHttpsHref = (href?: null | string): string | undefined => {
  const safeHref = getSafeHref(href);
  if (!safeHref) {
    return undefined;
  }

  try {
    const url = new URL(safeHref);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const getSafeMarkdownHref = (href: string): string => {
  const safeHref = getSafeHref(href);
  if (!safeHref) {
    return '';
  }

  if (safeHref.startsWith('/') || safeHref.startsWith('#')) {
    return safeHref;
  }

  return getSafeHttpsHref(safeHref) ?? '';
};
