export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;

  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
};

export const normalizeUrlBase = (value?: string): string => {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    /[\r\n?#]/.test(trimmed)
  ) {
    return '';
  }

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return trimTrailingSlashes(prefixed);
};

export const normalizeServiceHostname = (value?: string): string => {
  const trimmed = value?.trim() ?? '';

  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    /[\s/@?#\\]/.test(trimmed)
  ) {
    return '';
  }

  try {
    const parsed = new URL(`http://${trimmed}`);
    return parsed.hostname &&
      parsed.pathname === '/' &&
      !parsed.username &&
      !parsed.password
      ? trimmed
      : '';
  } catch {
    return '';
  }
};

export const buildServiceUrl = ({
  useSsl,
  hostname,
  port,
  urlBase,
  path = '',
}: {
  useSsl?: boolean;
  hostname?: string;
  port?: number;
  urlBase?: string;
  path?: string;
}): string =>
  `${useSsl ? 'https' : 'http'}://${normalizeServiceHostname(hostname)}:${
    port ?? ''
  }${normalizeUrlBase(urlBase)}${path}`;
