export function parseOidcAuthorizationRedirect(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('OIDC authorization redirect must be a URL string.');
  }

  const url = new URL(value);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new TypeError('OIDC authorization redirect is not allowed.');
  }

  return url.toString();
}
